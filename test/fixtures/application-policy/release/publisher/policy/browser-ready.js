(() => ({
        href: location.href,
        title: document.title,
        loadState: window.__RHOSPITAL_LOAD_STATE__ || null,
        firstFloor: Boolean(window.game?.scene?.isActive?.('FirstFloor')),
        ready: Boolean(window.game?.scene?.isActive?.('FirstFloor')) || window.__RHOSPITAL_LOAD_STATE__?.phase === 'launched',
        failed: Boolean(window.__RHOSPITAL_LOAD_STATE__?.phase?.endsWith('-error') || window.__RHOSPITAL_LOAD_STATE__?.phase === 'asset-timeout')
      }))()
