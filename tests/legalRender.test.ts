/**
 * Static-render tests for the public legal pages.
 *
 * Rendering the real `LegalPage` component to static markup (no browser, no
 * network) proves the component tree builds, that route resolution picks the
 * right document, and that the rendered HTML actually contains the substantive
 * disclosures a reviewer looks for — without depending on a live server.
 *
 * Run with: npm test
 */
import { check, finish } from './_harness';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LegalPage } from '../src/components/Legal/LegalPage';
import { LEGAL } from '../src/components/Legal/legalContent';

function render(path: string): string {
    return renderToStaticMarkup(createElement(LegalPage, { path }));
}

const privacy = render('/privacy');
const terms = render('/terms');

// --- Rendering does not throw and produces real documents ---
{
    check('privacy renders markup', privacy.length > 4000);
    check('terms renders markup', terms.length > 4000);
    check('privacy has an h1', /<h1[\s>]/.test(privacy));
    check('terms has an h1', /<h1[\s>]/.test(terms));
    check('privacy h1 is the Privacy Policy', privacy.includes('Privacy Policy'));
    check('terms h1 is the Terms of Service', terms.includes('Terms of Service'));

    // Semantic HTML landmarks for accessibility.
    check('privacy has a main landmark', privacy.includes('id="legal-main"'));
    check('privacy has a header landmark', privacy.includes('<header'));
    check('privacy has a footer landmark', privacy.includes('<footer'));
    check('privacy has a contents nav', privacy.includes('aria-label="Contents of the Privacy Policy"'));
    check('privacy sections carry anchors', privacy.includes('id="account-deletion"'));
    check('terms sections carry anchors', terms.includes('id="liability"'));

    // Effective date must be visible on the page.
    check('privacy shows the effective date', privacy.includes(LEGAL.effectiveDate) && privacy.includes('Effective date'));
    check('terms shows the effective date', terms.includes(LEGAL.effectiveDate));

    // Contact details are rendered as a mailto link.
    check('privacy links the support email', privacy.includes(`mailto:${LEGAL.supportEmail}`));
    check('terms links the support email', terms.includes(`mailto:${LEGAL.supportEmail}`));

    // Cross-links between the two documents.
    check('privacy links to /terms', privacy.includes('href="/terms"'));
    check('terms links to /privacy', terms.includes('href="/privacy"'));
    check('privacy links back to home', privacy.includes('href="/"'));

    // Key required disclosures for Google OAuth / provider verification.
    check('privacy discloses Google sign-in data', privacy.includes('Information we receive through Google sign-in'));
    check('privacy states the Limited Use requirement', privacy.includes('Limited Use'));
    check('privacy names the AI providers', privacy.includes('NVIDIA') && privacy.includes('Groq') && privacy.includes('OpenRouter'));
    check('privacy addresses account deletion', privacy.includes('Account and data deletion'));
    check('privacy addresses retention', privacy.includes('Data storage and retention'));

    // Terms-specific required warnings.
    check('terms warns about AI output', terms.includes('AI-generated output limitations'));
    check('terms warns about execution risk', terms.includes('Code execution risks'));
    check('terms covers beta status', terms.includes('Beta status and experimental features'));
    check('terms covers liability', terms.includes('Limitation of liability'));
    check('terms covers prohibiting malware', /malware/i.test(terms));
}

finish('Legal pages (static render)');
