// Codespaces supplies these non-secret values for its authenticated port forwarder.
export function previewHostname() {
  const name = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  return name && domain ? `${name}-3000.${domain}` : null;
}
