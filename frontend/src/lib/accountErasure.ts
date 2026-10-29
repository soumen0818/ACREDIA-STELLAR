/**
 * Shared between /api/account/erase and the Settings screen.
 *
 * Only students delete their own account. Institution staff and admins are
 * removed by support so an institution never loses its ability to issue
 * without anyone noticing (review §3.10, docs/support-procedures.md §4).
 */

/** Error code the erase route returns to institution staff and admins. */
export const SELF_DELETION_NOT_AVAILABLE = 'self_deletion_not_available';
