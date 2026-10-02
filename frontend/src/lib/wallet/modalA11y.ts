/**
 * Accessibility repairs for the wallet-selection modal.
 *
 * Stellar Wallets Kit 2.7.0 ships two gaps that ACREDIA-STELLAR#272's
 * "keyboard-navigable and passes the a11y suite" criterion does not tolerate,
 * and neither is configurable — the kit's internal `Button` takes no label
 * prop, and its overlay markup has no hooks:
 *
 *  1. The header controls (help, back, close) are icon-only, with no
 *     `aria-label` and no text node. axe rates this *critical*; measured
 *     against the real modal before this fix:
 *
 *         axe violations: 1
 *           [critical] button-name: Buttons must have discernible text (2 nodes)
 *
 *     A screen-reader user met those buttons as "button, button".
 *
 *  2. The overlay carries no `role="dialog"` and no `aria-modal`, so assistive
 *     technology presents it as ordinary page content rather than as something
 *     that has taken over the screen.
 *
 *  3. Its icon buttons size purely from padding, landing at 34x34px — under the
 *     44px minimum WCAG 2.5.5 and both mobile platforms ask for. Measured at
 *     360px wide, which is the width this has to work at
 *     (ACREDIA-STELLAR#4). Too small to hit reliably with a thumb.
 *
 * This is the screen where someone decides whether to trust us with a wallet,
 * so both are repaired here rather than waited on upstream. Each repair is
 * written to become a no-op the moment the kit fixes it.
 *
 * The modal renders into the light DOM as a plain `<div><section>` appended
 * to `<body>` — no custom element, no shadow root — which is what makes this
 * possible at all. Identification is by SVG path data because that is the only
 * stable thing about these buttons: they carry no id, no role and no text, and
 * their class names are hashed by the kit's CSS-in-JS and change between
 * builds.
 */

/** Leading path data for each icon, long enough to be unambiguous. */
const ICON_LABELS: ReadonlyArray<{ pathPrefix: string; label: string }> = [
    {
        // Circled question mark.
        pathPrefix: 'M12 22C6.47715 22 2 17.5228 2 12C2 6.47715',
        label: 'Help with connecting a wallet',
    },
    {
        // X / close.
        pathPrefix: 'M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093',
        label: 'Close wallet selection',
    },
    {
        // Left arrow / back.
        pathPrefix: 'M7.82843 10.9999H20V12.9999H7.82843L13.1924 18.3638',
        label: 'Back',
    },
];

/**
 * The label for an icon, identified by its SVG path data.
 *
 * Pure and exported so the path prefixes can be tested against the kit's real
 * icon data — a kit upgrade that redraws an icon would otherwise silently stop
 * matching, and nothing would notice until the next manual audit.
 */
export function labelForIconPath(pathData: string | null | undefined): string | null {
    if (!pathData) return null;
    return ICON_LABELS.find(({ pathPrefix }) => pathData.startsWith(pathPrefix))?.label ?? null;
}

function labelFor(button: Element): string | null {
    return labelForIconPath(button.querySelector('svg path')?.getAttribute('d'));
}

/**
 * Adds an accessible name to every unlabelled icon button inside the modal.
 *
 * Idempotent, and never overwrites a name the kit may add in a future
 * release — the check is for an *absent* name, so this quietly becomes a
 * no-op once upstream fixes it.
 */
export function labelModalIconButtons(root: ParentNode): number {
    let labelled = 0;

    for (const button of root.querySelectorAll('button')) {
        const hasName =
            Boolean(button.getAttribute('aria-label')) ||
            Boolean(button.getAttribute('title')) ||
            (button.textContent ?? '').trim().length > 0;

        if (hasName) continue;

        const label = labelFor(button);
        if (!label) continue;

        button.setAttribute('aria-label', label);
        labelled += 1;
    }

    return labelled;
}

/**
 * Announces the modal as a dialog.
 *
 * The kit renders an undifferentiated `<div><section><section>` with no
 * `role="dialog"` and no `aria-modal`, so assistive technology presents it as
 * more page content rather than as something that has taken over the screen.
 * Verified against the kit's `components/app.js`, which contains neither
 * attribute.
 *
 * The role goes on the *dialog card* — the element holding the header and the
 * wallet list — rather than on the full-viewport backdrop behind it, which is
 * what `aria-modal` expects: the backdrop is decoration, the card is the thing
 * with a name and content.
 *
 * The card is located as the nearest `<section>` ancestor of the close button's
 * `<header>`, because nothing about the container itself is identifiable: no id
 * and no stable class (the kit's class names are CSS-in-JS hashes). Measured
 * structure, with the modal open in a 1280×720 viewport:
 *
 *     DIV                  1280×0     ← mount point
 *       SECTION            1280×720   ← backdrop (decoration)
 *         SECTION           352×400   ← the dialog card  ◀ role goes here
 *           DIV             352×50    ← header row
 *             HEADER                  ← holds close button + <h1>
 *
 * `closest('section')` is used rather than counting parents so that an extra
 * wrapper in a future kit release shifts nothing.
 */
/**
 * The minimum comfortable touch target, in CSS pixels.
 *
 * WCAG 2.5.5 (Target Size, AAA) asks for 44x44; Apple's HIG and Material both
 * land on the same figure independently. The kit's icon buttons come out at
 * 34x34 because it sizes them from padding alone.
 */
const MIN_TOUCH_TARGET_PX = 44;

/**
 * Enlarges the modal's icon buttons to a thumb-sized target.
 *
 * Applied to every viewport rather than only to phones: a 44px target is not
 * worse with a mouse, and a width-conditional rule would silently stop
 * applying if the kit ever changed when it mounts. Written as inline
 * `min-width`/`min-height` because the kit's class names are CSS-in-JS hashes
 * that no stylesheet of ours can target.
 */
function enlargeTouchTargets(root: ParentNode): void {
    for (const label of ICON_LABELS) {
        const button = root.querySelector<HTMLElement>(`button[aria-label="${label.label}"]`);
        if (!button || button.dataset.acrediaTouchTarget === 'done') continue;

        button.style.minWidth = `${MIN_TOUCH_TARGET_PX}px`;
        button.style.minHeight = `${MIN_TOUCH_TARGET_PX}px`;
        // The kit centres the icon with padding; without this the glyph sits
        // off-centre once the box grows.
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.dataset.acrediaTouchTarget = 'done';
    }
}

function markUpDialog(root: ParentNode): void {
    const closeButton = root.querySelector('button[aria-label="Close wallet selection"]');
    const header = closeButton?.closest('header');
    const card = header?.parentElement?.closest('section');

    if (!card || card.getAttribute('role') === 'dialog') return;

    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');

    // Point the dialog's name at the kit's own heading rather than inventing
    // a second one, so the two can never disagree.
    const heading = header?.querySelector('h1');
    if (heading) {
        heading.id ||= 'acredia-wallet-modal-title';
        card.setAttribute('aria-labelledby', heading.id);
    } else {
        card.setAttribute('aria-label', 'Select a wallet');
    }
}

/**
 * Watches for the modal and labels its buttons as they appear.
 *
 * A one-shot pass is not enough: the kit mounts the modal asynchronously and
 * re-renders the header when navigating to its help page, which replaces the
 * help button with a back button. The observer runs for the lifetime of the
 * page, which costs nothing measurable and means every route inside the modal
 * is covered.
 *
 * Safe to call more than once — the second call is a no-op.
 */
let observer: MutationObserver | null = null;
let keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
let previousFocus: HTMLElement | null = null;
let activeDialog: HTMLElement | null = null;

function dialogControls(dialog: HTMLElement): HTMLElement[] {
    return Array.from(
        dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
        ),
    ).filter((element) => element.getClientRects().length > 0);
}

export function ensureModalA11y(): void {
    // Capture the initiating control before async loading disables it or moves focus.
    if (
        typeof document !== 'undefined' &&
        typeof HTMLElement !== 'undefined' &&
        document.activeElement instanceof HTMLElement &&
        !activeDialog
    ) {
        previousFocus = document.activeElement;
    }
    if (observer) return;

    // Every dependency is checked rather than inferred from one of them: this
    // runs during `connect()`, and an a11y enhancement must never be what
    // stops a user from reaching their wallet. Server rendering and the Node
    // test environment both land here.
    if (
        typeof document === 'undefined' ||
        !document.body ||
        typeof MutationObserver === 'undefined'
    ) {
        return;
    }

    // Swept from `body` rather than from a modal root: the kit gives its
    // container no identifying tag, id or class we could target, and the
    // SVG-path match is specific enough that a wider scope costs nothing —
    // a button that already has a name is skipped, and one without a matching
    // icon path is left alone.
    const sweep = () => {
        // Order matters: the labels are what the other two repairs locate the
        // buttons and the dialog card by.
        labelModalIconButtons(document.body);
        markUpDialog(document.body);
        enlargeTouchTargets(document.body);
        const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        if (dialog && !activeDialog) {
            previousFocus ??=
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            activeDialog = dialog;
            dialogControls(dialog)[0]?.focus();
        } else if (!dialog && activeDialog) {
            activeDialog = null;
            const trigger = previousFocus;
            previousFocus = null;
            // The auth promise re-enables Connect after the modal unmounts.
            requestAnimationFrame(() => {
                if (trigger?.isConnected) trigger.focus();
            });
        }
    };

    keyboardHandler = (event) => {
        if (!activeDialog?.isConnected) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            activeDialog
                .querySelector<HTMLButtonElement>('button[aria-label="Close wallet selection"]')
                ?.click();
        } else if (event.key === 'Tab') {
            const controls = dialogControls(activeDialog);
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) return;
            if (
                event.shiftKey &&
                (document.activeElement === first || !activeDialog.contains(document.activeElement))
            ) {
                event.preventDefault();
                last.focus();
            } else if (
                !event.shiftKey &&
                (document.activeElement === last || !activeDialog.contains(document.activeElement))
            ) {
                event.preventDefault();
                first.focus();
            }
        }
    };
    document.addEventListener('keydown', keyboardHandler);
    observer = new MutationObserver(sweep);
    observer.observe(document.body, { childList: true, subtree: true });
    sweep();
}

/** Test seam: drops the observer so a suite can start clean. */
export function __resetModalA11yForTests(): void {
    observer?.disconnect();
    observer = null;
    if (keyboardHandler && typeof document !== 'undefined')
        document.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
    activeDialog = null;
    previousFocus = null;
}
