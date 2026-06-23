(function () {
  const loginForm = document.getElementById('loginForm');
  const loginMessage = document.getElementById('loginMessage');
  const requestedNext = getQueryParam('next');
  const requestedModule = getQueryParam('module');
  const requestedArea = getQueryParam('area');
  const areaHint = document.getElementById('loginAreaHint');

  function defaultRouteFor(user) {
    if (!user) return '/login.html';
    if (user.role === 'OPERADOR') {
      return `/operator.html?module=${encodeURIComponent(user.moduleId || '')}&operator=${encodeURIComponent(user.username || '')}`;
    }
    return '/admin.html';
  }

  function canAccessRequestedNext(user) {
    if (!requestedNext) return true;
    if (!user) return false;
    const nextLower = String(requestedNext).toLowerCase();
    if (!nextLower.includes('/operator.html')) return true;
    if (String(user.role || '').toUpperCase() !== 'OPERADOR') return false;
    if (!requestedModule) return true;
    return String(user.moduleId || '').toLowerCase() === String(requestedModule || '').toLowerCase();
  }

  if (areaHint && (requestedArea || requestedModule)) {
    areaHint.textContent = `Ingreso solicitado para ${requestedArea || requestedModule}. Use un usuario registrado para esa área.`;
  }

  (async () => {
    const current = await syncSessionUser();
    if (current && canAccessRequestedNext(current)) {
      window.location.href = requestedNext || defaultRouteFor(current);
    }
  })();

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginMessage.textContent = '';
    loginMessage.classList.remove('error');
    const payload = Object.fromEntries(new FormData(loginForm).entries());
    try {
      const response = await api('/api/login', { method: 'POST', body: JSON.stringify(payload) });
      setSessionToken(response.sessionToken);
      setSessionUser(response.user);
      const redirect = canAccessRequestedNext(response.user) ? (requestedNext || response.redirect || defaultRouteFor(response.user)) : (response.redirect || defaultRouteFor(response.user));
      window.location.href = redirect;
    } catch (error) {
      loginMessage.textContent = error.message;
      loginMessage.classList.add('error');
    }
  });
})();
