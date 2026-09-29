'use strict';

document.getElementById('year').textContent = new Date().getFullYear();

// Mobile navigation
const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
toggle.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});
links.addEventListener('click', (e) => {
  if (e.target.tagName === 'A') {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }
});

// Server status indicator
const dot = document.getElementById('server-dot');
const statusText = document.getElementById('server-status');
fetch('/api/health')
  .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
  .then(() => {
    dot.classList.add('ok');
    statusText.textContent = 'Server online';
  })
  .catch(() => {
    dot.classList.add('down');
    statusText.textContent = 'Server nicht erreichbar';
  });
