const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error?.message || 'Request failed');
  return body;
};

function show(id, message, type) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `form-message ${type}`;
}

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    sessionStorage.setItem('brightloop_access_token', result.data.accessToken);
    show('login-message', `Signed in as ${result.data.user.displayName} (${result.data.user.role}).`, 'success');
  } catch (error) { show('login-message', error.message, 'error'); }
});

document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
    show('register-message', 'Account created. You can now sign in.', 'success');
    event.currentTarget.reset();
  } catch (error) { show('register-message', error.message, 'error'); }
});
