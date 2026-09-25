const form = document.querySelector('[data-login]');
const error = document.querySelector('[data-error]');
const next = new URLSearchParams(location.search).get('next');
const safeNext = next && /^\/admin\/[\w\-/]*$/.test(next) ? next : '/admin/dashboard';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  if (!form.reportValidity()) return;
  const btn = form.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to sign in. Please try again.');
    location.assign(safeNext);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    form.password.select();
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});
