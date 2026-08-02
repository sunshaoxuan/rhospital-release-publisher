using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

internal static class Program
{
    private const string ServiceNameValue = "RHospitalReleaseConsole";

    private static void Main(string[] args)
    {
        ServiceOptions options = ServiceOptions.Parse(args);
        ServiceBase.Run(new ServiceBase[] { new ReleaseConsoleService(ServiceNameValue, options) });
    }
}

internal sealed class ServiceOptions
{
    internal string RepositoryRoot { get; private set; }
    internal string ProjectRoot { get; private set; }
    internal string ExpectedUser { get; private set; }
    internal string BindAddress { get; private set; }
    internal int Port { get; private set; }

    internal static ServiceOptions Parse(string[] args)
    {
        ServiceOptions options = new ServiceOptions();
        options.Port = 8787;
        options.BindAddress = "127.0.0.1";

        for (int index = 0; index < args.Length; index++)
        {
            string key = args[index];
            if (key == "--service")
            {
                continue;
            }
            if (index + 1 >= args.Length)
            {
                throw new ArgumentException("Missing value for " + key);
            }
            string value = args[++index];
            if (key == "--repository-root")
            {
                options.RepositoryRoot = Path.GetFullPath(value);
            }
            else if (key == "--project-root")
            {
                options.ProjectRoot = Path.GetFullPath(value);
            }
            else if (key == "--user")
            {
                options.ExpectedUser = value;
            }
            else if (key == "--bind-address")
            {
                options.BindAddress = value;
            }
            else if (key == "--port")
            {
                options.Port = int.Parse(value);
            }
            else
            {
                throw new ArgumentException("Unknown argument " + key);
            }
        }

        if (string.IsNullOrWhiteSpace(options.RepositoryRoot)
            || string.IsNullOrWhiteSpace(options.ProjectRoot)
            || string.IsNullOrWhiteSpace(options.ExpectedUser))
        {
            throw new ArgumentException("Repository root, project root, and user are required");
        }
        return options;
    }
}

internal sealed class ReleaseConsoleService : ServiceBase
{
    private readonly object sync = new object();
    private readonly ServiceOptions options;
    private readonly string logPath;
    private Timer ensureTimer;
    private Process child;
    private IntPtr childJob = IntPtr.Zero;
    private int ensuring;
    private int stopping;
    private DateTime lastWaitingLog = DateTime.MinValue;

    internal ReleaseConsoleService(string serviceName, ServiceOptions serviceOptions)
    {
        ServiceName = serviceName;
        options = serviceOptions;
        logPath = Path.Combine(options.RepositoryRoot, ".service", "service-host.log");
        CanStop = true;
        CanShutdown = true;
        CanHandleSessionChangeEvent = true;
        CanHandlePowerEvent = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(logPath));
        childJob = NativeMethods.CreateKillOnCloseJob();
        WriteLog("service started for " + options.ExpectedUser);
        ensureTimer = new Timer(EnsureChild, null, TimeSpan.Zero, TimeSpan.FromSeconds(15));
    }

    protected override void OnStop()
    {
        StopService("service stop requested");
    }

    protected override void OnShutdown()
    {
        StopService("system shutdown");
        base.OnShutdown();
    }

    protected override void OnSessionChange(SessionChangeDescription changeDescription)
    {
        WriteLog("session change " + changeDescription.Reason + " session=" + changeDescription.SessionId);
        ThreadPool.QueueUserWorkItem(EnsureChild);
        base.OnSessionChange(changeDescription);
    }

    protected override bool OnPowerEvent(PowerBroadcastStatus powerStatus)
    {
        WriteLog("power event " + powerStatus);
        if (powerStatus == PowerBroadcastStatus.ResumeAutomatic
            || powerStatus == PowerBroadcastStatus.ResumeCritical
            || powerStatus == PowerBroadcastStatus.ResumeSuspend)
        {
            ThreadPool.QueueUserWorkItem(EnsureChild);
        }
        return true;
    }

    private void StopService(string reason)
    {
        if (Interlocked.Exchange(ref stopping, 1) != 0)
        {
            return;
        }
        WriteLog(reason);
        if (ensureTimer != null)
        {
            ensureTimer.Dispose();
            ensureTimer = null;
        }
        StopChildProcessTree();
        if (childJob != IntPtr.Zero)
        {
            NativeMethods.CloseHandle(childJob);
            childJob = IntPtr.Zero;
        }
        WriteLog("service stopped");
    }

    private void EnsureChild(object state)
    {
        if (Volatile.Read(ref stopping) != 0 || Interlocked.Exchange(ref ensuring, 1) != 0)
        {
            return;
        }

        try
        {
            lock (sync)
            {
                if (child != null)
                {
                    try
                    {
                        if (!child.HasExited)
                        {
                            return;
                        }
                    }
                    catch (InvalidOperationException)
                    {
                    }
                    child.Dispose();
                    child = null;
                }

                Process started;
                string startError;
                if (!InteractiveProcessLauncher.TryStart(options, childJob, out started, out startError))
                {
                    if ((DateTime.UtcNow - lastWaitingLog).TotalSeconds >= 60)
                    {
                        WriteLog("waiting for interactive user: " + startError);
                        lastWaitingLog = DateTime.UtcNow;
                    }
                    return;
                }

                child = started;
                child.EnableRaisingEvents = true;
                child.Exited += ChildExited;
                WriteLog("started hidden runner pid=" + child.Id);
            }
        }
        catch (Exception error)
        {
            WriteLog("child start failed: " + error);
        }
        finally
        {
            Volatile.Write(ref ensuring, 0);
        }
    }

    private void ChildExited(object sender, EventArgs args)
    {
        Process exited = sender as Process;
        int exitCode = -1;
        try
        {
            exitCode = exited.ExitCode;
        }
        catch
        {
        }
        WriteLog("hidden runner exited pid=" + exited.Id + " code=" + exitCode);

        lock (sync)
        {
            if (ReferenceEquals(child, exited))
            {
                child.Dispose();
                child = null;
            }
        }

        if (Volatile.Read(ref stopping) == 0)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(TimeSpan.FromSeconds(10));
                EnsureChild(null);
            });
        }
    }

    private void StopChildProcessTree()
    {
        Process processToStop = null;
        lock (sync)
        {
            processToStop = child;
            child = null;
        }
        if (processToStop == null)
        {
            return;
        }

        try
        {
            if (!processToStop.HasExited)
            {
                ProcessStartInfo stopInfo = new ProcessStartInfo("taskkill.exe", "/pid " + processToStop.Id + " /t /f");
                stopInfo.UseShellExecute = false;
                stopInfo.CreateNoWindow = true;
                stopInfo.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process stopper = Process.Start(stopInfo))
                {
                    stopper.WaitForExit(10000);
                }
            }
        }
        catch (Exception error)
        {
            WriteLog("runner stop failed: " + error.Message);
        }
        finally
        {
            processToStop.Dispose();
        }
    }

    private void WriteLog(string message)
    {
        try
        {
            string line = "[" + DateTimeOffset.Now.ToString("o") + "] " + message + Environment.NewLine;
            lock (sync)
            {
                File.AppendAllText(logPath, line, new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }
}

internal static class InteractiveProcessLauncher
{
    private const uint InvalidSessionId = 0xFFFFFFFF;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;

    internal static bool TryStart(ServiceOptions options, IntPtr jobHandle, out Process process, out string error)
    {
        process = null;
        error = string.Empty;
        IntPtr userToken = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        try
        {
            uint sessionId;
            if (!TryGetExpectedUserToken(options.ExpectedUser, out userToken, out sessionId, out error))
            {
                return false;
            }

            if (!NativeMethods.CreateEnvironmentBlock(out environment, userToken, false))
            {
                error = new Win32Exception(Marshal.GetLastWin32Error()).Message;
                return false;
            }

            string powerShell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            string runner = Path.Combine(options.RepositoryRoot, "scripts", "run-release-console.ps1");
            string commandLine = Quote(powerShell)
                + " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(runner)
                + " -RepositoryRoot " + Quote(options.RepositoryRoot)
                + " -ProjectRoot " + Quote(options.ProjectRoot)
                + " -BindAddress " + Quote(options.BindAddress)
                + " -Port " + options.Port;

            NativeMethods.STARTUPINFO startupInfo = new NativeMethods.STARTUPINFO();
            startupInfo.cb = Marshal.SizeOf(startupInfo);
            NativeMethods.PROCESS_INFORMATION processInfo;
            bool created = NativeMethods.CreateProcessAsUser(
                userToken,
                powerShell,
                new StringBuilder(commandLine),
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CreateNoWindow | CreateSuspended | CreateUnicodeEnvironment,
                environment,
                options.RepositoryRoot,
                ref startupInfo,
                out processInfo);
            if (!created)
            {
                error = new Win32Exception(Marshal.GetLastWin32Error()).Message;
                return false;
            }

            try
            {
                if (!NativeMethods.AssignProcessToJobObject(jobHandle, processInfo.hProcess))
                {
                    error = "assign process to job failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                    NativeMethods.TerminateProcess(processInfo.hProcess, 1);
                    return false;
                }
                if (NativeMethods.ResumeThread(processInfo.hThread) == uint.MaxValue)
                {
                    error = "resume process failed: " + new Win32Exception(Marshal.GetLastWin32Error()).Message;
                    NativeMethods.TerminateProcess(processInfo.hProcess, 1);
                    return false;
                }
                process = Process.GetProcessById((int)processInfo.dwProcessId);
                return true;
            }
            finally
            {
                NativeMethods.CloseHandle(processInfo.hThread);
                NativeMethods.CloseHandle(processInfo.hProcess);
            }
        }
        finally
        {
            if (environment != IntPtr.Zero)
            {
                NativeMethods.DestroyEnvironmentBlock(environment);
            }
            if (userToken != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(userToken);
            }
        }
    }

    private static bool TryGetExpectedUserToken(
        string expectedUser,
        out IntPtr userToken,
        out uint sessionId,
        out string error)
    {
        userToken = IntPtr.Zero;
        sessionId = InvalidSessionId;
        error = string.Empty;
        List<uint> candidates = CandidateSessionIds();
        List<string> failures = new List<string>();

        foreach (uint candidateSessionId in candidates)
        {
            IntPtr candidateToken = IntPtr.Zero;
            try
            {
                if (!NativeMethods.WTSQueryUserToken(candidateSessionId, out candidateToken))
                {
                    failures.Add("session " + candidateSessionId + ": "
                        + new Win32Exception(Marshal.GetLastWin32Error()).Message);
                    continue;
                }

                using (WindowsIdentity identity = new WindowsIdentity(candidateToken))
                {
                    if (!string.Equals(identity.Name, expectedUser, StringComparison.OrdinalIgnoreCase))
                    {
                        failures.Add("session " + candidateSessionId + " belongs to " + identity.Name);
                        continue;
                    }
                }

                userToken = candidateToken;
                candidateToken = IntPtr.Zero;
                sessionId = candidateSessionId;
                return true;
            }
            catch (Exception candidateError)
            {
                failures.Add("session " + candidateSessionId + ": " + candidateError.Message);
            }
            finally
            {
                if (candidateToken != IntPtr.Zero)
                {
                    NativeMethods.CloseHandle(candidateToken);
                }
            }
        }

        error = candidates.Count == 0
            ? "no interactive Windows session is available"
            : "no session token matched " + expectedUser + "; " + string.Join("; ", failures.ToArray());
        return false;
    }

    private static List<uint> CandidateSessionIds()
    {
        List<uint> active = new List<uint>();
        List<uint> retained = new List<uint>();
        IntPtr sessionBuffer = IntPtr.Zero;
        int sessionCount = 0;
        try
        {
            if (NativeMethods.WTSEnumerateSessions(
                IntPtr.Zero, 0, 1, out sessionBuffer, out sessionCount))
            {
                int itemSize = Marshal.SizeOf(typeof(NativeMethods.WTS_SESSION_INFO));
                for (int index = 0; index < sessionCount; index++)
                {
                    IntPtr item = IntPtr.Add(sessionBuffer, index * itemSize);
                    NativeMethods.WTS_SESSION_INFO session = (NativeMethods.WTS_SESSION_INFO)
                        Marshal.PtrToStructure(item, typeof(NativeMethods.WTS_SESSION_INFO));
                    uint id = unchecked((uint)session.SessionId);
                    if (session.State == NativeMethods.WTS_CONNECTSTATE_CLASS.WTSActive)
                    {
                        AddUnique(active, id);
                    }
                    else if (session.State == NativeMethods.WTS_CONNECTSTATE_CLASS.WTSConnected
                        || session.State == NativeMethods.WTS_CONNECTSTATE_CLASS.WTSDisconnected)
                    {
                        AddUnique(retained, id);
                    }
                }
            }
        }
        finally
        {
            if (sessionBuffer != IntPtr.Zero)
            {
                NativeMethods.WTSFreeMemory(sessionBuffer);
            }
        }

        uint consoleSessionId = NativeMethods.WTSGetActiveConsoleSessionId();
        if (consoleSessionId != InvalidSessionId)
        {
            AddUnique(active, consoleSessionId);
        }
        foreach (uint id in retained)
        {
            AddUnique(active, id);
        }
        return active;
    }

    private static void AddUnique(List<uint> sessions, uint sessionId)
    {
        if (!sessions.Contains(sessionId))
        {
            sessions.Add(sessionId);
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}

internal static class NativeMethods
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;

    internal enum WTS_CONNECTSTATE_CLASS
    {
        WTSActive,
        WTSConnected,
        WTSConnectQuery,
        WTSShadow,
        WTSDisconnected,
        WTSIdle,
        WTSListen,
        WTSReset,
        WTSDown,
        WTSInit
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct WTS_SESSION_INFO
    {
        internal int SessionId;
        internal IntPtr WinStationName;
        internal WTS_CONNECTSTATE_CLASS State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFO
    {
        internal int cb;
        internal string lpReserved;
        internal string lpDesktop;
        internal string lpTitle;
        internal int dwX;
        internal int dwY;
        internal int dwXSize;
        internal int dwYSize;
        internal int dwXCountChars;
        internal int dwYCountChars;
        internal int dwFillAttribute;
        internal int dwFlags;
        internal short wShowWindow;
        internal short cbReserved2;
        internal IntPtr lpReserved2;
        internal IntPtr hStdInput;
        internal IntPtr hStdOutput;
        internal IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        internal IntPtr hProcess;
        internal IntPtr hThread;
        internal uint dwProcessId;
        internal uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        internal long PerProcessUserTimeLimit;
        internal long PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize;
        internal UIntPtr MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass;
        internal uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        internal ulong ReadOperationCount;
        internal ulong WriteOperationCount;
        internal ulong OtherOperationCount;
        internal ulong ReadTransferCount;
        internal ulong WriteTransferCount;
        internal ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        internal IO_COUNTERS IoInfo;
        internal UIntPtr ProcessMemoryLimit;
        internal UIntPtr JobMemoryLimit;
        internal UIntPtr PeakProcessMemoryUsed;
        internal UIntPtr PeakJobMemoryUsed;
    }

    internal static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        JOBOBJECT_EXTENDED_LIMIT_INFORMATION information = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        information.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        int length = Marshal.SizeOf(information);
        IntPtr pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)length))
            {
                int error = Marshal.GetLastWin32Error();
                CloseHandle(job);
                throw new Win32Exception(error);
            }
            return job;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    [DllImport("kernel32.dll")]
    internal static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WTSEnumerateSessions(
        IntPtr serverHandle,
        int reserved,
        int version,
        out IntPtr sessionInfo,
        out int count);

    [DllImport("wtsapi32.dll")]
    internal static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateProcessAsUser(
        IntPtr token,
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);
}
