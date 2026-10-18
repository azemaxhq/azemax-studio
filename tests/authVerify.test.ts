/**
 * Frontend authentication presentation tests (pure logic, no DOM).
 *
 * Guards the two things that made the verification pane untrustworthy:
 *  - a non-deliverable address (`local-dev@azemax.local`, `*.local`, fixtures)
 *    must never be presented as a real verification destination;
 *  - every auth pane must carry distinct, non-empty copy (no repeated marketing
 *    headline across login / sign-up / verification / recovery).
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import {
    VERIFICATION_RESEND_COOLDOWN_SECONDS,
    isDeliverableEmail,
    verificationTarget,
    verificationTargetLabel,
} from '../src/core/auth/verification';
import { AUTH_COPY } from '../src/core/auth/copy';

// ---------------------------------------------------------------------------
// Deliverability guard (the .local fix)
// ---------------------------------------------------------------------------
{
    check('deliverable: normal address accepted', isDeliverableEmail('dev@azemax.dev') === true);
    check('deliverable: subdomain accepted', isDeliverableEmail('user@mail.example.org') === true);
    check('deliverable: case/space normalized', isDeliverableEmail('  DEV@Azemax.DEV ') === true);

    check('deliverable: dev bypass fixture rejected', isDeliverableEmail('local-dev@azemax.local') === false);
    check('deliverable: guest fixture rejected', isDeliverableEmail('guest@azemax.local') === false);
    check('deliverable: .local TLD rejected', isDeliverableEmail('someone@host.local') === false);
    check('deliverable: .test TLD rejected', isDeliverableEmail('someone@host.test') === false);
    check('deliverable: .invalid TLD rejected', isDeliverableEmail('someone@host.invalid') === false);
    check('deliverable: .example TLD rejected', isDeliverableEmail('someone@host.example') === false);
    check('deliverable: bare localhost rejected', isDeliverableEmail('root@localhost') === false);
    check('deliverable: empty rejected', isDeliverableEmail('') === false);
    check('deliverable: null rejected', isDeliverableEmail(null) === false);
    check('deliverable: malformed rejected', isDeliverableEmail('not-an-email') === false);

    const good = verificationTarget('Engineer@Azemax.dev');
    check('target: deliverable exposes normalized address', good.address === 'engineer@azemax.dev' && good.deliverable === true);

    const fixture = verificationTarget('local-dev@azemax.local');
    check('target: fixture exposes no address', fixture.address === null && fixture.deliverable === false);

    check('label: real address used verbatim', verificationTargetLabel('dev@azemax.dev') === 'dev@azemax.dev');
    check('label: fixture falls back to neutral phrase', verificationTargetLabel('local-dev@azemax.local') === 'your email address');
    check('label: null falls back to neutral phrase', verificationTargetLabel(null) === 'your email address');

    check('cooldown: resend cooldown is 60s', VERIFICATION_RESEND_COOLDOWN_SECONDS === 60);
}

// ---------------------------------------------------------------------------
// Page copy — present, distinct, and task-adapted
// ---------------------------------------------------------------------------
{
    const keys = Object.keys(AUTH_COPY) as Array<keyof typeof AUTH_COPY>;
    check('copy: covers every auth pane', keys.length === 4);

    check('copy: every pane has a title + description', keys.every((k) => {
        const c = AUTH_COPY[k];
        return c.title.trim().length > 0 && c.description.trim().length > 0;
    }));

    check('copy: every pane has brand messaging', keys.every((k) => {
        const c = AUTH_COPY[k];
        return c.brandHeadline.trim().length > 0 && c.brandSubheadline.trim().length > 0;
    }));

    const titles = new Set(keys.map((k) => AUTH_COPY[k].title));
    check('copy: form titles are unique per pane', titles.size === keys.length);

    const brandHeadlines = new Set(keys.map((k) => AUTH_COPY[k].brandHeadline));
    check('copy: brand headlines are not repeated across panes', brandHeadlines.size === keys.length);

    check('copy: login heading is "Welcome back"', AUTH_COPY.login.title === 'Welcome back');
    check('copy: verification pane says "Verify your email"', AUTH_COPY.verify.title === 'Verify your email');
}

finish('authVerify');
