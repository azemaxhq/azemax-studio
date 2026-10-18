/**
 * Tests for the public legal routes (/privacy, /terms) and the integrity of
 * the legal documents: routing predicates, document resolution, structural
 * sanity, and the required disclosure sections for sign-in provider review.
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import {
    AUTH_ROUTES,
    LEGAL_ROUTES,
    isAppRoutePath,
    isAuthRoutePath,
    isLegalRoutePath,
} from '../src/utils/appRouter';
import {
    LEGAL,
    LEGAL_PATHS,
    legalDocumentForPath,
    PRIVACY_POLICY,
    TERMS_OF_SERVICE,
    type LegalDocument,
} from '../src/components/Legal/legalContent';

// --- Route predicates ---
{
    check('identifies /privacy', isLegalRoutePath('/privacy'));
    check('identifies /terms', isLegalRoutePath('/terms'));
    check('handles trailing slash /privacy/', isLegalRoutePath('/privacy/'));
    check('handles trailing slash /terms/', isLegalRoutePath('/terms/'));
    check('rejects /app as legal route', !isLegalRoutePath('/app'));
    check('rejects / as legal route', !isLegalRoutePath('/'));
    check('rejects prefix bleed /privacy-extra', !isLegalRoutePath('/privacy-extra'));
    check('rejects empty string', !isLegalRoutePath(''));

    // Legal routes must be disjoint from app and auth routes, or App.tsx would
    // render the wrong surface (and possibly the auth gate over a public page).
    for (const route of LEGAL_ROUTES) {
        check(`legal route ${route} is not an app route`, !isAppRoutePath(route));
        check(`legal route ${route} is not an auth route`, !isAuthRoutePath(route));
    }
    check('legal routes are not registered as auth routes', !(AUTH_ROUTES as readonly string[]).includes('/privacy'));

    check('LEGAL_ROUTES covers both paths', LEGAL_ROUTES.includes(LEGAL_PATHS.privacy) && LEGAL_ROUTES.includes(LEGAL_PATHS.terms));
}

// --- Document resolution ---
{
    check('/privacy resolves to the privacy policy', legalDocumentForPath('/privacy')?.kind === 'privacy');
    check('/terms resolves to the terms of service', legalDocumentForPath('/terms')?.kind === 'terms');
    check('/privacy/ resolves to the privacy policy', legalDocumentForPath('/privacy/')?.kind === 'privacy');
    check('non-legal path resolves to null', legalDocumentForPath('/app') === null);
    check('unknown path resolves to null', legalDocumentForPath('/whatever') === null);
}

// --- Document integrity (applied to both documents) ---
function auditDocument(label: string, doc: LegalDocument): void {
    check(`${label}: has a title`, doc.title.length > 0);
    check(`${label}: has an effective date`, doc.effectiveDate.length > 0);
    check(`${label}: has a last-updated date`, doc.lastUpdated.length > 0);
    check(`${label}: effective date matches the shared constant`, doc.effectiveDate === LEGAL.effectiveDate);
    check(`${label}: has a substantive number of sections`, doc.sections.length >= 20);

    // Unique anchors are required for the table of contents and deep links.
    const ids = doc.sections.map((s) => s.id);
    check(`${label}: section ids are unique`, new Set(ids).size === ids.length);
    check(`${label}: every section has a title`, doc.sections.every((s) => s.title.trim().length > 0));
    check(`${label}: every section has content`, doc.sections.every((s) => s.blocks.length > 0));

    // Flatten all rendered text for content checks.
    const text = doc.sections
        .flatMap((s) => [s.title, ...s.blocks.flatMap((b) => (b.kind === 'p' || b.kind === 'note' ? [b.text] : b.items.map((i) => (typeof i === 'string' ? i : `${i.term ?? ''} ${i.text}`))))])
        .join('\n');

    check(`${label}: includes the support email`, text.includes(LEGAL.supportEmail));
    check(`${label}: references the other legal document`, text.includes(LEGAL_PATHS.privacy) || text.includes(LEGAL_PATHS.terms));
    check(`${label}: mentions Firebase authentication`, /firebase/i.test(text));

    // No unfinished placeholders may ship to a public verification surface.
    check(`${label}: contains no TODO/FIXME markers`, !/\bTODO\b|\bFIXME\b|\bLorem ipsum\b/i.test(text));
    check(`${label}: contains no unfilled bracket placeholders`, !/\[[A-Z_ ]{3,}\]|\{\{[^}]*\}\}/.test(text));
    check(`${label}: contains no invented company registration number`, !/registration no|company no\.|CRN\b/i.test(text));
}

auditDocument('Privacy Policy', PRIVACY_POLICY);
auditDocument('Terms of Service', TERMS_OF_SERVICE);

// --- Privacy Policy: required disclosures ---
{
    const ids = PRIVACY_POLICY.sections.map((s) => s.id);
    for (const required of [
        'introduction',
        'who-we-are',
        'information-we-collect',
        'google-sign-in',
        'email-password',
        'ai-input',
        'code-and-content',
        'technical-and-storage',
        'how-we-use',
        'ai-processing',
        'ai-providers',
        'google-api-data',
        'storage-retention',
        'account-deletion',
        'security',
        'sharing',
        'international-transfers',
        'children',
        'your-rights',
        'jurisdiction-rights',
        'email-communications',
        'cookies',
        'changes',
        'contact',
    ]) {
        check(`privacy: has the "${required}" section`, ids.includes(required));
    }

    const text = JSON.stringify(PRIVACY_POLICY);
    check('privacy: states the Limited Use requirement', /Limited Use/i.test(text));
    check('privacy: states Google sign-in is optional', /optional/i.test(text));
    check('privacy: lists at least three AI providers', /NVIDIA/.test(text) && /Groq/.test(text) && /OpenRouter/.test(text));
    // It must NOT make unconditional guarantees about storage/training/retention.
    check('privacy: avoids unconditional storage/training guarantees', !/never (stores|trains|retains)|zero (data )?retention|we never keep/i.test(text));
    // ...and it must explicitly acknowledge the provider-side uncertainty.
    check('privacy: explicitly acknowledges provider-side uncertainty', /do not claim|do not promise|cannot (promise|state)/i.test(text));
    check('privacy: links to the Terms of Service', text.includes(LEGAL_PATHS.terms));
}

// --- Terms of Service: required disclosures ---
{
    const ids = TERMS_OF_SERVICE.sections.map((s) => s.id);
    for (const required of [
        'acceptance',
        'eligibility',
        'accounts',
        'responsibilities',
        'acceptable-use',
        'prohibited',
        'ai-output',
        'your-content',
        'ownership',
        'license',
        'third-party-processing',
        'code-execution',
        'ip',
        'third-party-software',
        'availability',
        'beta',
        'limits',
        'security-responsible-use',
        'termination',
        'account-closure',
        'disclaimers',
        'liability',
        'indemnification',
        'governing-law',
        'changes-to-terms',
        'contact',
    ]) {
        check(`terms: has the "${required}" section`, ids.includes(required));
    }

    const text = JSON.stringify(TERMS_OF_SERVICE);
    check('terms: warns AI output may be incorrect/insecure', /incorrect|insecure/i.test(text));
    check('terms: requires users to review generated code', /review, test, and validate/i.test(text));
    check('terms: prohibits malware', /malware/i.test(text));
    check('terms: covers code-execution risk', /sandbox|isolation/i.test(text));
    check('terms: preserves mandatory consumer rights', /mandatory consumer/i.test(text));
    check('terms: links to the Privacy Policy', text.includes(LEGAL_PATHS.privacy));
}

finish('Legal routes & documents');
