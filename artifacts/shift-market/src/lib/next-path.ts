/** Where to go after signing in: back to an invitation link, otherwise the overview. */
export function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return /^\/invite\/[\w-]+$/.test(next) ? next : '/overview';
}
