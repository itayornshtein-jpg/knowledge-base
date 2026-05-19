/**
 * Extract a short ticket key (e.g. "OPS-421") from a JIRA URL.
 * Falls back to "JIRA" when no key can be parsed.
 *
 *   https://jira.company.com/browse/OPS-421       → "OPS-421"
 *   https://company.atlassian.net/browse/PROJ-99  → "PROJ-99"
 *   "OPS-421"                                     → "OPS-421"
 *   ""                                            → ""
 */
export function jiraTicketKey(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  const m = trimmed.match(/([A-Z][A-Z0-9_]+-\d+)/);
  if (m) return m[1];
  // Fall back to the last path segment for unusual URL shapes
  try {
    const url = new URL(trimmed);
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) return last;
  } catch (_) {
    /* not a URL */
  }
  return 'JIRA';
}
