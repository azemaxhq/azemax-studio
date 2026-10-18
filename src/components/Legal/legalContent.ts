/**
 * Legal document content — Azemax Studio.
 *
 * This module is the single source of truth for the Privacy Policy and Terms
 * of Service text. Shared metadata (operator, contact, URLs) and the block
 * types live in `legalMeta.ts` so small consumers do not pull this prose into
 * the initial bundle.
 *
 * Accuracy rule: every factual claim here is grounded in the repository audit
 * (authentication via Firebase, AI provider routing, Wandbox execution, SQLite
 * persistence, localStorage keys). Statements that cannot be verified from the
 * codebase or the relevant provider's published terms are deliberately phrased
 * as unknown or user-controlled rather than as guarantees. Do not add
 * "we never..." claims about storage, training, or retention without evidence.
 *
 * Inline markup supported by the renderer:
 *   **bold**            → strong text
 *   [label](href)       → link (internal `/paths` navigate without reload)
 *   `code`              → monospace inline
 */

import {
    LEGAL,
    LEGAL_PATHS,
    LEGAL_ABSOLUTE,
    type LegalBlock,
    type LegalBullet,
    type LegalDocument,
    type LegalSection,
} from './legalMeta';

export { LEGAL, LEGAL_PATHS, LEGAL_ABSOLUTE };
export type { LegalBlock, LegalBullet, LegalDocument, LegalSection };

const CONTACT = `[${LEGAL.supportEmail}](mailto:${LEGAL.supportEmail})`;
const PRIVACY_LINK = `[Privacy Policy](${LEGAL_PATHS.privacy})`;
const TERMS_LINK = `[Terms of Service](${LEGAL_PATHS.terms})`;

/* ------------------------------------------------------------------ *
 * PRIVACY POLICY
 * ------------------------------------------------------------------ */

export const PRIVACY_POLICY: LegalDocument = {
    kind: 'privacy',
    eyebrow: 'Privacy',
    title: 'Privacy Policy',
    intro:
        'This Privacy Policy explains what information Azemax Studio collects, why we collect it, how it is used and stored, and the choices you have. It is written to describe the application as it is actually built, including its limits.',
    effectiveDate: LEGAL.effectiveDate,
    lastUpdated: LEGAL.lastUpdated,
    version: LEGAL.version,
    sections: [
        {
            id: 'introduction',
            title: '1. Introduction, scope, and effective date',
            blocks: [
                {
                    kind: 'p',
                    text: `This Privacy Policy applies to the Azemax Studio web application (the "Service"), an AI-assisted code editor and development environment, and to any related pages we operate. It describes how we handle personal information when you visit the Service, create an account, write and run code, use AI features, or contact us.`,
                },
                {
                    kind: 'p',
                    text: `**Effective date:** ${LEGAL.effectiveDate}. **Last updated:** ${LEGAL.lastUpdated}. This policy replaces any earlier version.`,
                },
                {
                    kind: 'p',
                    text: `By using the Service you acknowledge this policy. If you do not agree with it, do not use the Service. This policy does not create contractual rights beyond those described here, and it should be read together with our ${TERMS_LINK}.`,
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `This document is provided for transparency and to support sign-in provider verification and app-store style review. It is not legal advice. Where the Service operates in a jurisdiction with binding privacy law, that law may give you rights that differ from the summary below.`,
                },
            ],
        },
        {
            id: 'who-we-are',
            title: '2. Who we are and how to contact us',
            blocks: [
                {
                    kind: 'p',
                    text: `"Azemax Studio", "we", "us", and "our" refer to the independent developer project that builds and operates the Service. The Service is published at ${LEGAL.website}. For the personal information described in this policy, we act as the data controller (or the equivalent role under applicable law).`,
                },
                {
                    kind: 'p',
                    text: `We are currently an independent project rather than a registered company, and we do not publish a corporate registration number or postal address. We deliberately do not state a country of establishment here because none is asserted by this document. If that changes, this policy will be updated.`,
                },
                {
                    kind: 'p',
                    text: `For any privacy question, request, or complaint, contact ${CONTACT}. This is the fastest route and the only contact channel we currently operate.`,
                },
            ],
        },
        {
            id: 'information-we-collect',
            title: '3. Information we collect',
            blocks: [
                {
                    kind: 'p',
                    text: `We collect only the categories the Service actually uses. In broad terms these are: account information, the content you create in the workspace, the input you send to AI features, and limited technical information needed to run and protect the Service.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'Account information', text: 'your email address, an optional display name, an optional profile photo URL, your account identifier, the sign-in method you used, whether your email is verified, and account timestamps (created, updated, last sign-in).' },
                        { term: 'Workspace content', text: 'the projects, folders, files, and file contents you create or open in the editor, together with project and activity timestamps.' },
                        { term: 'AI feature input', text: 'the prompts, questions, code snippets, selected text, filenames, and project context you submit to AI features.' },
                        { term: 'Chat history', text: 'the AI conversations you conduct in the Service, including your messages and the responses you receive.' },
                        { term: 'Technical information', text: 'request metadata such as the HTTP method, path, response status, and latency; error diagnostics; and, transiently, your IP address, which we use only as an in-memory key for abuse and rate limiting.' },
                        { term: 'Support correspondence', text: 'anything you choose to send us by email, including your email address and the content of your message.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We do not ask for, and do not intend to collect, special categories of personal data, payment card data, government identifiers, biometric data, or precise location data. Please do not send us this information.`,
                },
            ],
        },
        {
            id: 'google-sign-in',
            title: '4. Information we receive through Google sign-in',
            blocks: [
                {
                    kind: 'p',
                    text: `You may create an account or sign in with Google. Google sign-in is optional: an email and password account is always available as an alternative. If you use Google, we receive your basic profile information through that sign-in.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'What we receive', text: 'your email address, your name (display name), your Google profile picture URL, an assertion that Google has verified your email address, and a unique account identifier used to link your account.' },
                        { term: 'What we do not receive', text: 'we request only the basic "profile" and "email" sign-in scopes. We do not request or receive access to your Gmail messages, Google Drive files, Google Contacts, Google Calendar, Google Photos, or any other Google service data.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We use this information only to create and authenticate your account, to display your name and avatar in the interface, to confirm that your email is verified so the workspace can open, and to keep your account secure. We do not use Google profile information for advertising or profiling, and we do not sell it. Because Google has verified the address, a Google sign-in does not require a separate email verification step.`,
                },
                {
                    kind: 'p',
                    text: `Google's own handling of your information is governed by Google's privacy policy and the permissions you grant on the Google account screen. We receive information from Google only after you grant it, and you can revoke the app's access at any time in your Google Account permissions.`,
                },
            ],
        },
        {
            id: 'email-password',
            title: '5. Email and password authentication information',
            blocks: [
                {
                    kind: 'p',
                    text: `If you register with an email address and password, the credentials are created and verified by our authentication provider, Firebase Authentication (a Google service).`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'We do not store or see your password. Password creation, hashing, verification, and storage are handled by Firebase, not by the Service.' },
                        { text: 'We store your email address, an optional display name, and account status fields (email verified, sign-in provider, timestamps) in our own database.' },
                        { text: 'We receive a short-lived identity token from Firebase that we use to authorise your requests. On the Service, this token is held in memory in your browser and is not written to a cookie or to browser storage by us. It is presented to our API in an HTTP header.' },
                        { text: 'Email verification: until a signed-up email address is verified, the workspace and the product APIs remain locked. You can resend the verification email or confirm verification in the interface.' },
                        { text: 'Password reset and account recovery are handled through Firebase by email.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `WebSocket connections (used by the terminal and code execution features) send the identity token as part of the connection URL, because browsers cannot attach custom headers to WebSocket handshakes. The token is short-lived. Do not share terminal session links or the browser address bar for an active session.`,
                },
            ],
        },
        {
            id: 'ai-input',
            title: '6. Information you submit to AI features',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service offers AI-assisted features such as chat, code generation, explanation, fixing, refactoring, and inline suggestions. To produce a response, these features send your input to an external AI provider.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'What may be transmitted', text: 'your prompt or question, the code you select or reference, the contents of the file or files in context, file names, a description of your file tree, and relevant parts of the current conversation.' },
                        { term: 'Why', text: 'this information is necessary to generate, explain, or modify code and to keep the conversation coherent. It is the substance of the request.' },
                        { term: 'Limits', text: 'context is trimmed to fit the provider request; for example, the number of messages, the characters per file, and the total context size are capped by the application.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `Treat anything you send to an AI feature as leaving your control and reaching a third party. Do not submit credentials, API keys, private keys, personal data about others, or confidential or regulated content that you are not authorised to disclose.`,
                },
            ],
        },
        {
            id: 'code-and-content',
            title: '7. Source code, prompts, project files, and generated content',
            blocks: [
                {
                    kind: 'p',
                    text: `Your workspace content belongs to you. This section explains what happens to it technically, not who owns it.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'While you are signed in, your workspace file tree and file contents are stored in your browser (browser storage) so the editor survives a reload, and are also synced to our servers so your workspace can follow you between devices.' },
                        { text: 'AI-generated code and other AI output are added to your workspace only when you apply or accept them. Once applied, they are treated as part of your content.' },
                        { text: 'Code you run through the execution feature may be transmitted to a third-party execution sandbox (see "How code execution works" below).' },
                        { text: 'AI conversations are stored in your browser and, when you are signed in, synced to our servers as part of your account state.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We do not use your source code or prompts to train our own AI models, and we do not operate our own model-training pipeline. We cannot state what a third-party AI provider does with data it receives; that is governed by the provider's own terms (see "Third-party AI providers").`,
                },
            ],
        },
        {
            id: 'technical-and-storage',
            title: '8. Technical information, logs, cookies, and local storage',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        { term: 'Server request logs', text: 'each API request is logged with the method, path, response status, latency, and (when signed in) an internal user identifier. We do not log request bodies, the content of your prompts, or your source code in these access logs.' },
                        { term: 'IP addresses', text: 'your IP address is used in memory to rate-limit abusive traffic and to cap concurrent sessions. It is not written to our application logs and is not retained as a stored identifier by the Service.' },
                        { term: 'Error diagnostics', text: 'when a request fails, we may record the route, status, and error message (not the payload) to diagnose the fault.' },
                        { term: 'Browser storage', text: 'the Service uses browser local storage for your workspace, settings, chat history, terminal metadata, layout preferences, and analysis history. Most of this is namespaced per account. It stays in your browser until you clear it or the Service overwrites it.' },
                        { term: 'Cookies', text: 'the Service does not set its own cookies for tracking or analytics. Our authentication provider (Firebase) may use its own browser storage to keep you signed in; that mechanism is provided by Firebase.' },
                        { term: 'Third-party scripts', text: 'the code editor component and web fonts may be loaded from a public content delivery network, which necessarily receives your IP address and user agent as part of serving those files.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `Details of cookie-equivalent technologies and how to clear them are in "Cookies and similar technologies" near the end of this policy.`,
                },
            ],
        },
        {
            id: 'how-we-use',
            title: '9. How we use personal information',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        { text: 'To create your account, authenticate you, verify your email, and keep you signed in.' },
                        { text: 'To provide the core features: editing, file and project management, AI assistance, code execution, and the terminal.' },
                        { text: 'To sync your workspace, settings, and conversations across your devices when you are signed in.' },
                        { text: 'To keep the Service secure and available, including rate limiting, abuse prevention, and fault diagnosis.' },
                        { text: 'To respond to your support requests and to send you service and account messages.' },
                        { text: 'To understand aggregate usage (such as counts of AI requests and executions per day) in order to apply fair-use limits and operate the Service.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We do not sell your personal information, we do not use it for behavioural advertising, and we do not build advertising profiles.`,
                },
            ],
        },
        {
            id: 'ai-processing',
            title: '10. How AI requests are processed',
            blocks: [
                {
                    kind: 'p',
                    text: `When you use an AI feature, the Service constructs a request on our server and forwards it to a configured AI provider. The API keys for these providers are held on our server and are never sent to your browser.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'The Service may select a provider and may fall back to another configured provider if the first is unavailable, rate-limited, or errors.' },
                        { text: 'We do not log the full contents of AI requests or responses in our server logs; we log provider, model, latency, and token/usage counters.' },
                        { text: 'We do not operate a separate archive of your raw AI requests beyond the conversation history that is part of your account state and browser storage.' },
                        { text: 'Whether a provider retains, reviews, or trains on a request is governed by that provider. We cannot promise a particular provider behaviour, so we do not.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `We do not claim that your code or prompts are never stored, never reviewed, or never used to improve a third-party model. Those outcomes depend on each provider's own terms and settings, which we do not control and which may change.`,
                },
            ],
        },
        {
            id: 'ai-providers',
            title: '11. Third-party AI providers and service providers',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service can route AI requests to one or more of the providers below. Which of them are active depends on how a given deployment is configured: a provider is only used if the operator has supplied credentials for it. When several are configured, requests are attempted in a priority order and may fall back.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'NVIDIA (build.nvidia.com)', text: 'primary configured provider for AI requests.' },
                        { term: 'Groq (groq.com)', text: 'configured fallback provider.' },
                        { term: 'OpenRouter (openrouter.ai)', text: 'configured fallback provider, which itself routes to underlying model hosts.' },
                        { term: 'Hugging Face (huggingface.co)', text: 'configured fallback inference provider.' },
                        { term: 'Kilo Code (kilocode.ai)', text: 'configured fallback provider.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `Each of these providers is an independent controller of the data it receives and applies its own privacy and retention terms. OpenRouter in particular may forward requests to further model providers. If you need certainty about a specific provider's retention or training practices, review that provider's current terms before submitting sensitive content, or avoid using AI features for that content.`,
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `Open item for the operator: the current provider list and priority above reflect the application's configuration code. Retention periods and training terms for each provider are not recorded in this repository and should be confirmed against each provider's published policy before relying on them.`,
                },
            ],
        },
        {
            id: 'google-api-data',
            title: '12. Google API and OAuth data handling',
            blocks: [
                {
                    kind: 'p',
                    text: `Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. In practice this means:`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'We request only the basic profile and email scopes needed to identify you and to confirm your email address.' },
                        { text: 'We use that information only to provide and improve user-facing features (sign-in, account creation, and displaying your account), and to keep the Service secure.' },
                        { text: 'We do not sell Google user data, we do not use it for advertising, and we do not use it to train AI models.' },
                        { text: 'We do not transfer Google user data to third parties except as necessary to provide the Service, to comply with the law, or as part of a merger or acquisition, and never for the purposes just listed.' },
                        { text: 'We do not allow humans to read your Google data except with your explicit consent, where necessary for security or to comply with law, or where the data has been aggregated and anonymised.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `You can revoke Azemax Studio's access to your Google account at any time from your Google Account's third-party app permissions. Revoking access prevents future Google sign-ins; it does not by itself delete your Azemax Studio account. To delete your account, see the next section.`,
                },
            ],
        },
        {
            id: 'storage-retention',
            title: '13. Data storage and retention',
            blocks: [
                {
                    kind: 'p',
                    text: `We keep information only as long as it is needed for the purposes described above. Where the Service has a clear deletion control, we describe it. Where a fixed retention period is not configured, we say so rather than inventing one.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'Account and authentication records', text: 'retained while your account is active, and until a deletion request is completed. There is no automatic expiry timer. See "Account and data deletion".' },
                        { term: 'Projects and workspaces', text: 'retained until you delete the project in the Service or delete your account. Deleting a project removes it from your account.' },
                        { term: 'AI conversations and settings', text: 'retained locally in your browser, and on our servers while you are signed in, until you delete the conversation or clear your chat history in the Service, or delete your account.' },
                        { term: 'Aggregate usage counters', text: 'per-day counters of AI requests, tokens, and executions are retained to enforce fair-use limits.' },
                        { term: 'Access and error logs', text: 'kept on the hosting platform for operational and security purposes. We do not currently configure a fixed log-retention schedule; retention is subject to the hosting provider\u2019s defaults.' },
                        { term: 'Browser storage', text: 'remains on your device until you clear site data. Signing out does not necessarily erase it.' },
                        { term: 'Third-party and provider records', text: 'any copies held by Firebase, an AI provider, the execution sandbox, or the hosting provider are governed by that provider\u2019s retention policy, which we do not control.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `Open item for the operator: a defined retention period for access logs, and any automatic purging of inactive accounts, is not configured in the current implementation. If a specific period is required by applicable law, it must be configured and then stated here.`,
                },
            ],
        },
        {
            id: 'account-deletion',
            title: '14. Account and data deletion',
            blocks: [
                {
                    kind: 'p',
                    text: `You can delete individual content at any time: delete projects and files in the workspace, delete conversations in the assistant, and clear your chat history. You can also clear the data stored in your browser by clearing site data for the Service.`,
                },
                {
                    kind: 'p',
                    text: `**Full account deletion.** Self-service account deletion is not yet implemented in the Service. Until it is, you can request deletion by emailing ${CONTACT} from the address associated with your account, with the subject "Account deletion". We will verify the request and delete your account record and associated server-side content from our active database.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'Please allow a reasonable period for us to action a request; deletion is currently performed manually.' },
                        { text: 'Deleting your Azemax Studio account does not automatically delete your Firebase authentication record. Ask us in the same email if you want that removed too, or use your Google account settings to revoke access.' },
                        { text: 'Copies held by third-party providers (AI providers, the execution sandbox, hosting platform) are subject to those providers\u2019 own deletion processes.' },
                        { text: 'Records we must keep to comply with a legal obligation, or to resolve a dispute, may be retained for as long as required.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `Open item for the operator: a self-service "delete my account" flow (including cancellation of any active Firebase identity and cascade deletion of projects, synced settings, and chat history) is not present in the current implementation. This is an implementation gap that should be closed before scale, and the manual process above is the only available route today.`,
                },
            ],
        },
        {
            id: 'security',
            title: '15. Security safeguards and their limitations',
            blocks: [
                {
                    kind: 'p',
                    text: `We apply reasonable technical measures, including: authentication through Firebase with server-side verification of every identity token; verification that a user owns the projects and account state they request; server-side API keys that are never exposed to the browser; size and rate limits on requests; and running user programs with a restricted environment rather than the application's own credentials.`,
                },
                {
                    kind: 'p',
                    text: `No service is perfectly secure, and we make no guarantee that unauthorised access, loss, or disclosure cannot occur. In particular:`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'Data you intentionally submit to an AI feature is transmitted to a third party by design; this is an inherent disclosure, not a breach.' },
                        { text: 'Interactive shell and local execution features, when enabled by a deployment operator, run code on that operator\u2019s host with limited isolation. This is disabled by default in production.' },
                        { text: 'You are responsible for the security of your own device, browser, and credentials.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We do not hold any security certification (for example ISO 27001 or SOC 2) and we do not claim compliance with any standard we have not independently verified.`,
                },
            ],
        },
        {
            id: 'sharing',
            title: '16. Data sharing and disclosure',
            blocks: [
                {
                    kind: 'p',
                    text: `We do not sell your personal information. We share it only as needed to run the Service, and only in the following circumstances:`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'AI providers', text: 'the input described in "Information you submit to AI features" is sent to the selected provider to produce a result.' },
                        { term: 'Execution sandbox', text: 'code and input you choose to run may be sent to a third-party sandbox service, which executes and returns the result.' },
                        { term: 'Authentication and hosting', text: 'Firebase processes authentication, and our hosting provider processes requests on our behalf.' },
                        { term: 'Content delivery', text: 'a public content delivery network serves the editor component and fonts, receiving your IP address to deliver the files.' },
                        { term: 'Legal and safety', text: 'we may disclose information if required by law, to enforce our terms, or to protect the rights, safety, and security of users or the public.' },
                        { term: 'Business transfer', text: 'if the project is transferred to a successor, information may transfer as part of that transition, subject to this policy.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We do not share Google sign-in data with advertisers or data brokers.`,
                },
            ],
        },
        {
            id: 'international-transfers',
            title: '17. International data transfers',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service and its providers may process and store information in countries other than the one you live in, including the United States, where many AI and cloud providers operate. This means your information may be transferred to, and processed in, a jurisdiction with different data-protection rules than your own.`,
                },
                {
                    kind: 'p',
                    text: `Where we are required to do so, we rely on appropriate safeguards for such transfers, such as the provider's contractual commitments and standard data-protection terms. Because we do not currently assert a specific establishment or a specific transfer mechanism for every provider, you should treat this section as a description of how the Service is built rather than as a certification of any particular adequacy mechanism.`,
                },
            ],
        },
        {
            id: 'children',
            title: "18. Children's privacy and age restrictions",
            blocks: [
                {
                    kind: 'p',
                    text: `The Service is a developer tool and is not directed to children. You must be at least 13 years old to use it. Where the law of your country requires a higher age for you to consent to online services on your own behalf (for example, some countries require parental consent up to a higher age), that higher age applies and you may only use the Service with the involvement of a parent or guardian.`,
                },
                {
                    kind: 'p',
                    text: `We do not knowingly collect personal information from children below the applicable minimum age. If you believe a child has provided us with personal information, contact ${CONTACT} and we will take steps to delete it.`,
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `Open item for the operator: the minimum age on the sign-up surface and the exact wording of the age rule should be confirmed against the law of the operator's target markets before relying on it. The Service does not currently ask for or verify a user's age.`,
                },
            ],
        },
        {
            id: 'your-rights',
            title: '19. Your privacy rights',
            blocks: [
                {
                    kind: 'p',
                    text: `Depending on where you live, you may have rights over your personal information, which can include the right to:`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'access the personal information we hold about you;' },
                        { text: 'correct information that is inaccurate;' },
                        { text: 'delete your information (see "Account and data deletion");' },
                        { text: 'restrict or object to certain processing;' },
                        { text: 'receive a portable copy of information you provided; and' },
                        { text: 'withdraw consent where processing is based on consent.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `You can exercise many of these directly in the Service (edit your profile, delete projects, delete conversations, clear chat history). For anything else, contact ${CONTACT}. We will respond within the time required by applicable law. We will not discriminate against you for exercising a privacy right.`,
                },
                {
                    kind: 'p',
                    text: `To the extent that our legal basis is legitimate interests, you may object; to the extent it is consent, you may withdraw it at any time without affecting processing already carried out.`,
                },
            ],
        },
        {
            id: 'jurisdiction-rights',
            title: '20. Jurisdiction-specific privacy rights',
            blocks: [
                {
                    kind: 'p',
                    text: `Where you live may give you specific rights under local law. This section summarises how the general rights above apply in commonly relevant frameworks. It is a good-faith summary, not legal advice, and it does not override any mandatory rights you have.`,
                },
                {
                    kind: 'list',
                    items: [
                        { term: 'EEA, UK, and Switzerland (GDPR / UK GDPR)', text: 'you have the rights listed above, plus the right to lodge a complaint with your local supervisory authority. Our legal bases are performance of a contract (providing the Service), legitimate interests (security, abuse prevention, service operation), and consent where required.' },
                        { term: 'California (CCPA/CPRA)', text: 'you have rights to know, delete, correct, and opt out of the "sale" or "sharing" of personal information. We do not sell personal information and we do not share it for cross-context behavioural advertising. We do not use or disclose sensitive personal information for purposes requiring a limitation right.' },
                        { term: 'Other US state privacy laws', text: 'where a state privacy law applies, we honour the equivalent rights to access, delete, correct, and opt out of targeted advertising and profiling. We do not conduct targeted advertising or profiling.' },
                        { term: 'Brazil, Canada, Australia, and others', text: 'we will honour access, correction, and deletion requests in line with the local framework that applies.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `If you are unsure which framework applies to you, contact ${CONTACT} and describe your request; we will treat it as broadly as we reasonably can.`,
                },
            ],
        },
        {
            id: 'email-communications',
            title: '21. Email communications',
            blocks: [
                {
                    kind: 'p',
                    text: `We send transactional and service emails that are part of operating your account, for example: email verification, password reset, and important notices about the Service or these policies. These are not marketing and are not sent unless they are needed for your account or required by law.`,
                },
                {
                    kind: 'p',
                    text: `We do not currently operate a marketing newsletter. If we introduce optional product emails, we will ask for consent where required and provide a way to opt out. You can always contact ${CONTACT} to ask about the messages you have received.`,
                },
            ],
        },
        {
            id: 'cookies',
            title: '22. Cookies and similar technologies',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service does not set tracking cookies and does not use cookie-based third-party analytics. It relies on browser local storage to remember your workspace, settings, chat history, terminal state, and layout, most of which is scoped to your signed-in account.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'Our authentication provider may store a small amount of data in your browser to keep you signed in; this is a functional, first-party-to-your-session use, not advertising.' },
                        { text: 'Loading the code editor component and fonts from a public content delivery network may set nothing in your browser but does disclose your IP address to that network.' },
                        { text: 'You can clear all browser storage for the Service at any time through your browser settings. Doing so removes your locally cached workspace and conversations and may sign you out.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `Because there are no advertising or analytics cookies, we do not operate a cookie consent banner for them. If that changes, we will update this section and, where required, ask for consent first.`,
                },
            ],
        },
        {
            id: 'changes',
            title: '23. Changes to this policy',
            blocks: [
                {
                    kind: 'p',
                    text: `We may update this policy as the Service changes or as the law requires. When we do, we will revise the effective date and the "last updated" date at the top, and, for material changes, we will take reasonable steps to notify you (for example, in-app or by email).`,
                },
                {
                    kind: 'p',
                    text: `Continued use of the Service after an update means you accept the revised policy. If you do not agree, stop using the Service and, if you wish, request account deletion.`,
                },
            ],
        },
        {
            id: 'contact',
            title: '24. Contact us',
            blocks: [
                {
                    kind: 'p',
                    text: `For any privacy question, request, or complaint, contact ${CONTACT}. We aim to respond promptly and within any period required by applicable law.`,
                },
                {
                    kind: 'p',
                    text: `You can also reach us for security reports at the same address. See our ${TERMS_LINK} for the rules that govern use of the Service.`,
                },
            ],
        },
    ],
};

/* ------------------------------------------------------------------ *
 * TERMS OF SERVICE
 * ------------------------------------------------------------------ */

export const TERMS_OF_SERVICE: LegalDocument = {
    kind: 'terms',
    eyebrow: 'Legal',
    title: 'Terms of Service',
    intro:
        'These Terms of Service govern your use of Azemax Studio, an AI-assisted code editor and development environment. Please read them carefully, especially the sections on AI output, code execution, and limitation of liability.',
    effectiveDate: LEGAL.effectiveDate,
    lastUpdated: LEGAL.lastUpdated,
    version: LEGAL.version,
    sections: [
        {
            id: 'acceptance',
            title: '1. Acceptance of these terms',
            blocks: [
                {
                    kind: 'p',
                    text: `By accessing or using Azemax Studio (the "Service"), creating an account, or clicking to accept when prompted, you agree to be bound by these Terms of Service (the "Terms"). If you do not agree, do not use the Service.`,
                },
                {
                    kind: 'p',
                    text: `These Terms form an agreement between you and the operator of the Service ("Azemax Studio", "we", "us", "our"). They apply together with our ${PRIVACY_LINK}, which explains how we handle personal information.`,
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `The Service is currently in public beta. Some provisions below reflect that stage and may change as the Service matures. Nothing here is legal advice, and the governing-law section should be reviewed by a qualified lawyer before the Service is relied upon commercially.`,
                },
            ],
        },
        {
            id: 'eligibility',
            title: '2. Eligibility and age requirements',
            blocks: [
                {
                    kind: 'p',
                    text: `You must be at least 13 years old to use the Service. Where the law of your country requires a higher age for you to agree to these Terms on your own behalf, that higher age applies.`,
                },
                {
                    kind: 'p',
                    text: `By using the Service you represent that you can form a binding contract with us, that you are not barred from using the Service under applicable law, and that any information you provide is accurate. If you use the Service on behalf of an organisation, you represent that you are authorised to bind that organisation to these Terms.`,
                },
            ],
        },
        {
            id: 'accounts',
            title: '3. Account registration and account security',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        { text: 'You need an account to use the workspace. You can register with an email address and password, or sign in with Google.' },
                        { text: 'You are responsible for keeping your credentials and your device secure, and for all activity that occurs under your account.' },
                        { text: 'Provide accurate information and keep it current. Do not impersonate another person or use another person\u2019s account.' },
                        { text: 'Notify us promptly at the contact address below if you suspect unauthorised access to your account.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We may suspend or restrict an account as described in "Suspension and termination". We are not liable for losses caused by your failure to keep your credentials secure.`,
                },
            ],
        },
        {
            id: 'responsibilities',
            title: '4. Your responsibilities',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        { text: 'Use the Service lawfully and in line with these Terms and any usage limits.' },
                        { text: 'Ensure you have the right to submit any code, data, or content you upload, paste, or send to AI features, and that doing so does not violate anyone else\u2019s rights or any confidentiality obligation.' },
                        { text: 'Review, test, and validate any AI-generated output before you use it.' },
                        { text: 'Maintain your own backups of anything important. See the beta section below.' },
                        { text: 'Treat execution results as untrusted input and apply normal security judgement before running or deploying anything.' },
                    ],
                },
            ],
        },
        {
            id: 'acceptable-use',
            title: '5. Acceptable use policy',
            blocks: [
                {
                    kind: 'p',
                    text: `You agree to use the Service in good faith and only for lawful, legitimate software-development purposes. You are responsible for the code you write and run, the data you submit, and the consequences of your decisions.`,
                },
                {
                    kind: 'p',
                    text: `Where the Service lets you execute code, run a terminal, or send content to third-party providers, you must consider the impact of those actions on others, on systems you do not own, and on the environment you run in.`,
                },
            ],
        },
        {
            id: 'prohibited',
            title: '6. Prohibited activities',
            blocks: [
                {
                    kind: 'p',
                    text: `You must not use the Service to:`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'break any law or regulation, or infringe anyone\u2019s intellectual-property, privacy, or other rights;' },
                        { text: 'create, distribute, or run malware, ransomware, spyware, or other harmful code;' },
                        { text: 'gain or attempt to gain unauthorised access to any system, account, network, or data, or to bypass security controls;' },
                        { text: 'steal credentials, run phishing or social-engineering campaigns, or harvest personal data without authorisation;' },
                        { text: 'attack, scan, overload, or disrupt the Service or any third party (including denial-of-service activity, cryptocurrency mining, or spam);' },
                        { text: 'submit content you are not authorised to disclose, including trade secrets or personal data of others;' },
                        { text: 'reverse engineer, resell, or abuse the Service, or attempt to extract provider API keys or bypass usage limits;' },
                        { text: 'use automated means to access the Service in a way that exceeds agreed limits or degrades it for others; or' },
                        { text: 'use AI features to generate content that is illegal, defamatory, harassing, hateful, sexually exploitative of minors, or otherwise harmful.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We may investigate suspected violations and cooperate with law enforcement where required.`,
                },
            ],
        },
        {
            id: 'ai-output',
            title: '7. AI-generated output limitations',
            blocks: [
                {
                    kind: 'p',
                    text: `AI features produce suggestions, not guarantees. Output may be incorrect, insecure, incomplete, outdated, non-compiling, or unsuitable for your purpose, and it may resemble existing code.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'You must review, test, and validate AI-generated code before relying on it, especially before using it in production, in security-sensitive contexts, or where errors could cause harm.' },
                        { text: 'You are solely responsible for the code you keep, run, and deploy, whether or not an AI feature produced it.' },
                        { text: 'We make no promise that AI output is original, non-infringing, secure, or fit for any particular purpose. You are responsible for checking licences and compliance.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `Do not treat AI output as professional advice of any kind (including legal, security, medical, or financial advice). Where a decision carries real risk, consult a qualified professional.`,
                },
            ],
        },
        {
            id: 'your-content',
            title: '8. Your content: code, prompts, and files',
            blocks: [
                {
                    kind: 'p',
                    text: `"Your Content" means the code, files, projects, prompts, messages, and other material you create, upload, or submit through the Service. You keep ownership of Your Content, as described in the next section.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'You must have the rights needed to submit Your Content and to permit the processing described in these Terms and our privacy policy.' },
                        { text: 'Do not submit credentials, secrets, private keys, personal data about others, or confidential material you are not authorised to disclose, particularly to AI features or code execution features.' },
                        { text: 'You are responsible for the legality, accuracy, and quality of Your Content.' },
                    ],
                },
            ],
        },
        {
            id: 'ownership',
            title: '9. Ownership of your content',
            blocks: [
                {
                    kind: 'p',
                    text: `You own Your Content. We do not claim ownership of the code you write, the files you create, or the prompts you submit. These Terms do not transfer your intellectual property to us.`,
                },
                {
                    kind: 'p',
                    text: `Ownership of AI-generated output is a developing area of law and may depend on the applicable jurisdiction and on the terms of the provider that generated it. We do not represent that AI output is protectable by, or free from, intellectual-property rights. You are responsible for how you use it.`,
                },
            ],
        },
        {
            id: 'license',
            title: '10. The limited license you grant us',
            blocks: [
                {
                    kind: 'p',
                    text: `To operate the Service we need a limited license to handle Your Content. You grant us a worldwide, non-exclusive, royalty-free license to host, store, transmit, display, and process Your Content solely for the purpose of providing, securing, and improving the Service you are using.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'This license includes sending the parts of Your Content you choose to submit to AI and code-execution providers, because that is how those features work.' },
                        { text: 'This license is limited to what is necessary to run the Service. It does not give us the right to sell Your Content, publish it publicly, or use it to train our own models.' },
                        { text: 'The license ends when you delete Your Content or your account, except for copies we must keep to comply with the law or that persist in provider systems or backups for a limited time.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `You also grant us permission to use your account email to send transactional messages about the Service.`,
                },
            ],
        },
        {
            id: 'third-party-processing',
            title: '11. AI provider processing and third-party dependencies',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service depends on third parties. AI features send your input to an AI provider; code execution may send your code to a third-party sandbox; authentication is provided by Firebase; and the editor component and fonts may be served from a content delivery network. Which AI providers are active depends on how a given deployment is configured.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'Your use of a third-party feature is also subject to that provider\u2019s terms. We do not control those providers and are not responsible for their acts or omissions.' },
                        { text: 'Provider availability, model selection, and behaviour may change without notice, and requests may fall back between providers.' },
                        { text: 'Because we cannot promise how a third-party provider handles data, we do not promise that submitted code or prompts are never stored or never used to improve a third-party model.' },
                    ],
                },
            ],
        },
        {
            id: 'code-execution',
            title: '12. Code execution risks',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service can run code and, in some configurations, open an interactive terminal. Execution carries real security and stability risk, and its isolation is limited.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'In production deployments, local execution and the interactive shell are disabled by default and code is run through a third-party sandbox. Where a deployment operator enables local execution or a shell, code may run on that operator\u2019s host with only limited process-level restrictions rather than a container or virtual-machine boundary.' },
                        { text: 'Do not run code you do not trust, code that attempts to escape a sandbox, code that consumes excessive resources, or code that targets systems you do not own or have permission to test.' },
                        { text: 'Execution has limits (for example, maximum code size, run time, and output size) and may be terminated, truncated, or fail.' },
                        { text: 'Code you run may be transmitted to a third-party execution service, so do not run secrets or sensitive data through it.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `We make no guarantee that any execution environment is isolated or secure, and you accept the risks of running code through the Service.`,
                },
            ],
        },
        {
            id: 'ip',
            title: '13. Intellectual property rights',
            blocks: [
                {
                    kind: 'list',
                    items: [
                        { term: 'Our property', text: 'the Service itself \u2014 including its name, logo, branding, design, interface, and original source code \u2014 is owned by us or our licensors and is protected by intellectual-property law. These Terms give you a limited, revocable, non-transferable right to use the Service; they do not transfer ownership of it.' },
                        { term: 'Your Content', text: 'remains yours, as described above.' },
                        { term: 'AI output', text: 'is not claimed by us as our property, subject to the uncertainty described in "Ownership of your content".' },
                        { term: 'Third-party components', text: 'the Service is built on third-party libraries, tools, and models, which are owned by their respective authors and used under their own licenses.' },
                    ],
                },
                {
                    kind: 'p',
                    text: `You may not copy, modify, distribute, sell, or lease any part of the Service, or use our branding, without our prior written permission, except as allowed by applicable law.`,
                },
            ],
        },
        {
            id: 'third-party-software',
            title: '14. Third-party software and open-source licenses',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service incorporates open-source and third-party software, including a code editor component, terminal components, and AI model services. Those components are governed by their own licenses and terms, which may include attribution and other requirements.`,
                },
                {
                    kind: 'p',
                    text: `Nothing in these Terms limits your rights under an applicable open-source license for that component. Where a third-party component imposes an obligation on us, we will honour it; where it imposes a condition on your use, that condition is between you and the relevant licensor.`,
                },
            ],
        },
        {
            id: 'availability',
            title: '15. Service availability and changes',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service is provided on an "as available" basis. We may add, change, or remove features, and we may suspend or discontinue the Service (in whole or in part) at any time.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'We do not guarantee uninterrupted or error-free availability, and the Service may be unavailable during maintenance, outages, or provider problems.' },
                        { text: 'Free-tier hosting may sleep after inactivity, causing a delay on the next request, and server-side storage may be lost if the hosting instance is redeployed or restarted. See the beta section below.' },
                        { text: 'We may impose or change fair-use limits, quotas, and rate limits to protect the Service and other users.' },
                    ],
                },
            ],
        },
        {
            id: 'beta',
            title: '16. Beta status and experimental features',
            blocks: [
                {
                    kind: 'p',
                    text: `The Service is in public beta. It is under active development and should be treated as experimental.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'Features may change, break, or be removed without notice, and behaviour may differ between deployments.' },
                        { text: 'Availability, performance, and any quotas may change and are not guaranteed.' },
                        { text: 'Temporary interruptions, data loss, and unexpected results can occur, including from experimental AI and execution features.' },
                        { text: 'You should keep your own copy of any important work outside the Service.' },
                    ],
                },
                {
                    kind: 'note',
                    tone: 'info',
                    text: `Beta status means the Service is provided with limited promises, but it does not remove any rights you have under mandatory consumer-protection law, and it does not give us unlimited immunity from liability.`,
                },
            ],
        },
        {
            id: 'limits',
            title: '17. Usage limits, quotas, and rate limits',
            blocks: [
                {
                    kind: 'p',
                    text: `To keep the Service stable and fair, we apply limits. These may include maximum request sizes, per-minute and per-day request caps, concurrent-session caps, workspace and file-size caps, and execution time and output limits.`,
                },
                {
                    kind: 'p',
                    text: `Limits are applied automatically and may change. Attempting to circumvent them, including by creating multiple accounts to exceed a cap, is a breach of these Terms. When a limit is hit, a request may be rejected or truncated.`,
                },
            ],
        },
        {
            id: 'security-responsible-use',
            title: '18. Security and responsible use',
            blocks: [
                {
                    kind: 'p',
                    text: `You agree to use the Service responsibly and to report security issues rather than exploit them. If you discover a vulnerability, contact us at the address below and give us a reasonable opportunity to fix it before disclosing it publicly.`,
                },
                {
                    kind: 'p',
                    text: `You must not attempt to access other users\u2019 data, probe or bypass authentication, or interfere with the Service or its providers. We may take technical and legal steps to protect the Service and its users.`,
                },
            ],
        },
        {
            id: 'termination',
            title: '19. Suspension and termination',
            blocks: [
                {
                    kind: 'p',
                    text: `We may suspend or terminate your access to the Service, with or without notice, if we reasonably believe you have breached these Terms, if required by law, or if your use poses a risk to the Service, other users, or third parties.`,
                },
                {
                    kind: 'p',
                    text: `You may stop using the Service at any time and can request account deletion as described below. On termination, your right to use the Service ends immediately, but provisions that by their nature should survive (such as ownership, disclaimers, limitation of liability, and governing law) will continue to apply.`,
                },
            ],
        },
        {
            id: 'account-closure',
            title: '20. Account closure and data handling',
            blocks: [
                {
                    kind: 'p',
                    text: `You can delete projects and conversations, clear your chat history, and clear the data stored in your browser at any time. Full self-service account deletion is not yet implemented; to close your account and request deletion of your server-side data, email us at the contact address below from your account email address.`,
                },
                {
                    kind: 'p',
                    text: `Our ${PRIVACY_LINK} explains what is deleted, what may be retained, and how third-party copies are handled.`,
                },
            ],
        },
        {
            id: 'disclaimers',
            title: '21. Disclaimers',
            blocks: [
                {
                    kind: 'p',
                    text: `To the fullest extent permitted by law, the Service is provided "as is" and "as available", without warranties of any kind, whether express, implied, or statutory, including any implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.`,
                },
                {
                    kind: 'list',
                    items: [
                        { text: 'We do not warrant that the Service will be uninterrupted, secure, or error-free, or that AI output or execution results will be accurate, complete, or suitable for any purpose.' },
                        { text: 'We do not warrant that Your Content will be preserved. You are responsible for backups.' },
                        { text: 'Nothing in these Terms excludes or limits any warranty or right that cannot lawfully be excluded or limited, including mandatory consumer rights in your jurisdiction.' },
                    ],
                },
            ],
        },
        {
            id: 'liability',
            title: '22. Limitation of liability',
            blocks: [
                {
                    kind: 'p',
                    text: `To the fullest extent permitted by applicable law, we will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, revenue, data, goodwill, or business opportunity, arising out of or relating to your use of the Service.`,
                },
                {
                    kind: 'p',
                    text: `To the fullest extent permitted by law, our total aggregate liability for all claims relating to the Service will not exceed the greater of (a) the amount you paid us for the Service in the twelve months before the claim, or (b) a nominal amount where the Service was free to you. Because the Service is currently offered free of charge, this cap will generally be nominal.`,
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `Some jurisdictions do not allow certain limitations of liability, so parts of this section may not apply to you. Nothing in these Terms limits liability that cannot lawfully be limited, and nothing here deprives you of mandatory consumer-protection rights.`,
                },
            ],
        },
        {
            id: 'indemnification',
            title: '23. Indemnification',
            blocks: [
                {
                    kind: 'p',
                    text: `To the extent permitted by applicable law, you agree to indemnify and hold us harmless from claims, damages, and reasonable costs arising from your misuse of the Service, Your Content, your violation of these Terms, or your infringement of the rights of a third party.`,
                },
                {
                    kind: 'p',
                    text: `This obligation does not apply to the extent a claim results from our own negligence or wilful misconduct, and it does not apply where it would be unenforceable under the consumer-protection law that applies to you.`,
                },
            ],
        },
        {
            id: 'governing-law',
            title: '24. Governing law and dispute resolution',
            blocks: [
                {
                    kind: 'p',
                    text: `These Terms are governed by the laws of the jurisdiction in which the operator of the Service is established. Because the operator is currently an independent project rather than a registered company, a specific country and legal forum are not asserted in these Terms; if and when one is established, this section will be updated to name it.`,
                },
                {
                    kind: 'p',
                    text: `For consumers, regardless of the above, you keep the protection of the mandatory rules of the law of your country of residence, and you may bring proceedings in your local courts where the law allows. Before starting any formal dispute, please contact us so we can try to resolve the matter informally.`,
                },
                {
                    kind: 'note',
                    tone: 'warn',
                    text: `Open item for the operator: this governing-law and dispute-resolution clause must be replaced with a concrete jurisdiction, forum, and (if used) an arbitration-and-class-action-waiver clause that is valid in the operator's target markets, reviewed by a qualified lawyer, before the Service is offered commercially.`,
                },
            ],
        },
        {
            id: 'changes-to-terms',
            title: '25. Changes to these terms',
            blocks: [
                {
                    kind: 'p',
                    text: `We may update these Terms as the Service changes or as the law requires. When we do, we will revise the effective date and the "last updated" date above and, for material changes, take reasonable steps to notify you.`,
                },
                {
                    kind: 'p',
                    text: `Continued use of the Service after an update means you accept the revised Terms. If you do not agree, stop using the Service and request account deletion if you wish.`,
                },
            ],
        },
        {
            id: 'contact',
            title: '26. Contact information',
            blocks: [
                {
                    kind: 'p',
                    text: `For questions about these Terms, account issues, security reports, or legal notices, contact ${CONTACT}.`,
                },
                {
                    kind: 'p',
                    text: `See also our ${PRIVACY_LINK} for how we handle personal information.`,
                },
            ],
        },
    ],
};

/** Resolve the document for a given pathname, or null when it is not a legal route. */
export function legalDocumentForPath(pathname: string): LegalDocument | null {
    const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    if (clean === LEGAL_PATHS.privacy) return PRIVACY_POLICY;
    if (clean === LEGAL_PATHS.terms) return TERMS_OF_SERVICE;
    return null;
}
