import java.io.BufferedWriter;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.List;
import java.util.Properties;
import java.util.zip.GZIPOutputStream;

public final class ReleaseTradePoolDatabaseAudit {
    private static final int EXPECTED_VERSION = requiredPositiveInt("RELEASE_EXPECTED_CATALOG_VERSION");
    private static final List<String> REQUIRED_COLUMNS = List.of(
            "listing_source", "admin_source_email", "admin_batch_id");
    private static final List<String> REQUIRED_INDEXES = List.of(
            "idx_toilet_listing_admin_batch", "idx_toilet_tx_type_id",
            "idx_toilet_tx_actor_id", "idx_toilet_tx_target_id");
    private static final List<String> BACKUP_TABLES = List.of(
            "t_backend_upgrade_markers", "t_toilet_market_listing", "t_toilet_market_transaction");

    private ReleaseTradePoolDatabaseAudit() {
    }

    public static void main(String[] args) throws Exception {
        String mode = required("RELEASE_DB_AUDIT_MODE");
        Class.forName("org.postgresql.Driver");
        Properties properties = new Properties();
        properties.setProperty("user", required("DB_USER"));
        properties.setProperty("password", required("DB_PASSWORD"));
        properties.setProperty("connectTimeout", "10");
        properties.setProperty("socketTimeout", "120");
        try (Connection connection = DriverManager.getConnection(required("DB_URL"), properties)) {
            boolean mutating = "suspend-admin".equals(mode);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setReadOnly(!mutating);
            connection.setAutoCommit(false);
            switch (mode) {
                case "inspect" -> inspect(connection);
                case "backup" -> backup(connection, Path.of(required("RELEASE_DB_BACKUP_DIR")));
                case "verify" -> verify(connection);
                case "suspend-admin" -> suspendAdmin(connection);
                default -> throw new IllegalArgumentException("Unsupported audit mode: " + mode);
            }
            if (mutating) {
                connection.commit();
            } else {
                connection.rollback();
            }
        }
    }

    private static void inspect(Connection connection) throws Exception {
        SchemaStatus status = schemaStatus(connection);
        System.out.println(status.asLine("tradepool_schema_preflight"));
        System.out.println("tradepool_schema_expected=" + EXPECTED_VERSION);
        if (status.markerVersion() > EXPECTED_VERSION) {
            throw new IllegalStateException("Catalog downgrade is blocked: database version "
                    + status.markerVersion() + " is newer than target version " + EXPECTED_VERSION);
        }
        if (status.markerVersion() == EXPECTED_VERSION && !"COMPLETED".equals(status.markerStatus())) {
            throw new IllegalStateException("Catalog marker at target version is not COMPLETED: "
                    + status.markerStatus());
        }
        System.out.println("tradepool_schema_transition=" + status.markerVersion() + "->" + EXPECTED_VERSION);
    }

    private static void verify(Connection connection) throws Exception {
        SchemaStatus status = schemaStatus(connection);
        System.out.println(status.asLine("tradepool_schema_postdeploy"));
        if (status.markerVersion() != EXPECTED_VERSION || !"COMPLETED".equals(status.markerStatus())) {
            throw new IllegalStateException("Catalog marker must equal target version " + EXPECTED_VERSION
                    + " with COMPLETED status");
        }
        if (status.columnCount() != REQUIRED_COLUMNS.size()) {
            throw new IllegalStateException("Required trade-pool columns are missing");
        }
        if (status.indexCount() != REQUIRED_INDEXES.size()) {
            throw new IllegalStateException("Required trade-pool indexes are missing");
        }
        System.out.println("tradepool_database_validation=PASS");
    }

    private static void backup(Connection connection, Path directory) throws Exception {
        Files.createDirectories(directory);
        SchemaStatus status = schemaStatus(connection);
        Files.writeString(directory.resolve("schema-status.txt"),
                status.asLine("tradepool_schema_backup") + System.lineSeparator(), StandardCharsets.UTF_8);
        for (String table : BACKUP_TABLES) {
            if (!tableExists(connection, table)) {
                Files.writeString(directory.resolve(table + ".missing"), "missing\n", StandardCharsets.UTF_8);
                continue;
            }
            writeQuery(connection, "select * from " + table, directory.resolve(table + ".tsv.gz"));
        }
        System.out.println("tradepool_database_backup=" + directory);
    }

    private static void suspendAdmin(Connection connection) throws Exception {
        if (!columnExists(connection, "t_toilet_market_listing", "listing_source")) {
            throw new IllegalStateException("listing_source column is missing; refusing old-code rollback");
        }
        try (PreparedStatement statement = connection.prepareStatement("""
                update t_toilet_market_listing
                set status = 'SUSPENDED', update_time = now()
                where listing_source = 'ADMIN' and status = 'ACTIVE'
                """)) {
            int updated = statement.executeUpdate();
            System.out.println("suspended_admin_listings=" + updated);
        }
    }

    private static SchemaStatus schemaStatus(Connection connection) throws Exception {
        int markerVersion = -1;
        String markerStatus = "MISSING";
        if (tableExists(connection, "t_backend_upgrade_markers")) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    select marker_version, status
                    from t_backend_upgrade_markers
                    where marker_key = 'catalog_item_store_v1'
                    """)) {
                try (ResultSet result = statement.executeQuery()) {
                    if (result.next()) {
                        markerVersion = result.getInt(1);
                        markerStatus = result.getString(2);
                    }
                }
            }
        }
        int columnCount = 0;
        for (String column : REQUIRED_COLUMNS) {
            if (columnExists(connection, "t_toilet_market_listing", column)) {
                columnCount++;
            }
        }
        int indexCount = 0;
        for (String index : REQUIRED_INDEXES) {
            if (indexExists(connection, index)) {
                indexCount++;
            }
        }
        return new SchemaStatus(markerVersion, markerStatus, columnCount, indexCount);
    }

    private static boolean tableExists(Connection connection, String table) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("select to_regclass(?) is not null")) {
            statement.setString(1, "public." + table);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getBoolean(1);
            }
        }
    }

    private static boolean columnExists(Connection connection, String table, String column) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select count(*)
                from information_schema.columns
                where table_schema = 'public' and table_name = ? and column_name = ?
                """)) {
            statement.setString(1, table);
            statement.setString(2, column);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getInt(1) == 1;
            }
        }
    }

    private static boolean indexExists(Connection connection, String index) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select count(*) from pg_indexes where schemaname = 'public' and indexname = ?
                """)) {
            statement.setString(1, index);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() && result.getInt(1) == 1;
            }
        }
    }

    private static void writeQuery(Connection connection, String sql, Path target) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(120);
            try (ResultSet result = statement.executeQuery(sql);
                 GZIPOutputStream gzip = new GZIPOutputStream(Files.newOutputStream(target));
                 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(gzip, StandardCharsets.UTF_8))) {
                ResultSetMetaData metadata = result.getMetaData();
                for (int column = 1; column <= metadata.getColumnCount(); column++) {
                    if (column > 1) writer.write('\t');
                    writer.write(escape(metadata.getColumnLabel(column)));
                }
                writer.newLine();
                while (result.next()) {
                    for (int column = 1; column <= metadata.getColumnCount(); column++) {
                        if (column > 1) writer.write('\t');
                        writer.write(escape(result.getString(column)));
                    }
                    writer.newLine();
                }
            }
        }
    }

    private static String escape(String value) {
        if (value == null) return "\\N";
        return value.replace("\\", "\\\\")
                .replace("\t", "\\t")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    private static int requiredPositiveInt(String name) {
        String value = required(name);
        try {
            int parsed = Integer.parseInt(value);
            if (parsed <= 0) throw new NumberFormatException("not positive");
            return parsed;
        } catch (NumberFormatException error) {
            throw new IllegalStateException(name + " must be a positive integer", error);
        }
    }

    private record SchemaStatus(int markerVersion, String markerStatus, int columnCount, int indexCount) {
        String asLine(String prefix) {
            return prefix + " marker=" + markerVersion + "|" + markerStatus
                    + " columns=" + columnCount + "/" + REQUIRED_COLUMNS.size()
                    + " indexes=" + indexCount + "/" + REQUIRED_INDEXES.size();
        }
    }
}
