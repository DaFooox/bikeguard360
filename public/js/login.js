'use strict';

const form = document.getElementById('auth-form');
const errorBox = document.getElementById('form-error');
const submit = document.getElementById('submit');
let mode = location.pathname.startsWith('/register') ? 'register' : 'login';

function setMode(next) {
  mode = next;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  document.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== mode; });
  submit.textContent = mode === 'login' ? 'Anmelden' : 'Konto erstellen';
  form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.title = `${mode === 'login' ? 'Anmelden' : 'Registrieren'} – BikeGuard360`;
  history.replaceState(null, '', `/${mode}`);
  errorBox.hidden = true;
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
document.getElementById('fill-demo').addEventListener('click', () => {
  form.email.value = 'demo@bikeguard360.de';
  form.password.value = 'demo1234';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Unbekannter Fehler');
    location.href = '/dashboard';
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

setMode(mode);
