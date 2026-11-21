/**
 * Canonical product FAQ. The same entries are rendered on /faq and emitted as
 * FAQPage structured data, so the markup and the schema cannot drift apart.
 *
 * Keep every answer grounded in the shipped implementation. Do not add
 * testimonials, adoption numbers, benchmarks, or pricing promises here.
 */

export interface FaqItem {
    id: string;
    question: string;
    answer: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
    {
        id: 'what-is-azemax',
        question: 'What is Azemax?',
        answer:
            'Azemax is an emerging technology startup building AI-powered software products, developer tools, and modern web technologies. Its public product is Azemax Studio, a browser-based AI code editor and agentic development workspace. The company website is https://www.azemax.com, and its public source repository is on GitHub.',
    },
    {
        id: 'what-is-azemax-studio',
        question: 'What is Azemax Studio?',
        answer:
            'Azemax Studio is a browser-based AI code editor and development workspace from Azemax. It combines a Monaco editing surface, a file tree and multi-tab workspace, an AI assistant that can inspect and change project files, code execution, and a diagnostics panel in one interface.',
    },
    {
        id: 'who-leads-azemax',
        question: 'Who founded Azemax, and who leads it?',
        answer:
            'Azemax was founded by Tharunkumar T., who serves as founder and CEO. He is responsible for the direction of the company and for its work on Azemax Studio. The official profile on this website records his role and responsibilities, and the About page publishes the company information. No other executives or leadership team members are publicly listed at this time.',
    },
    {
        id: 'who-is-tharunkumar-t',
        question: 'Who is Tharunkumar T.?',
        answer:
            'Tharunkumar T. is the founder and CEO of Azemax, an emerging technology startup. He leads the company and its work on Azemax Studio, the browser-based AI code editor. His official profile at https://www.azemax.com/leadership/tharunkumar-t records his role, biography, and verified professional links. No other executives or leadership team members are publicly listed.',
    },
    {
        id: 'install',
        question: 'Do I need to install anything?',
        answer:
            'No. Azemax Studio runs in a modern desktop browser such as Chrome, Firefox, Safari, or Edge. There is no desktop package or command-line installer for the hosted product. You need an account, and an internet connection, because authentication, workspace sync, AI requests, and hosted code execution use online services.',
    },
    {
        id: 'api-key',
        question: 'Do I need my own AI API key?',
        answer:
            'No. The default Azemax mode sends AI requests through the Azemax backend, which uses the service’s own model configuration. Bring Your Own Key is optional: it lets you route requests to your own provider account and choose the model yourself.',
    },
    {
        id: 'providers',
        question: 'Which AI providers and models can I use?',
        answer:
            'Bring Your Own Key supports OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, NVIDIA NIM, and any HTTPS endpoint that implements an OpenAI-compatible chat completions API. The settings panel offers a starter model list for each built-in provider and can fetch the provider’s model catalog when the provider supports it. Model availability and naming are controlled by the provider.',
    },
    {
        id: 'key-storage',
        question: 'Where are my provider API keys stored?',
        answer:
            'By default, a key is kept only in memory for the current browser tab and disappears when the tab closes. If you enable “Remember on this device,” the key is encrypted with a key derived from a passphrase you choose, and only the ciphertext is stored in the browser’s IndexedDB. In BYOK mode, requests go from your browser to the provider you selected, not through the Azemax AI backend. No browser-based storage can protect a key from malicious JavaScript running in an unlocked session, so use a restricted key and revoke it at the provider if it may have been exposed.',
    },
    {
        id: 'agent-edits',
        question: 'Does the AI agent change my files automatically?',
        answer:
            'Yes. Agent and Edit modes can create, modify, rename, and delete files in the workspace as part of a task; they are not read-only chat. The assistant reports which files it touched, and edits are validated against the workspace before they are written. AI output can still be wrong, so review the changed files and test the result. There is no automatic Git commit or guaranteed undo for every file operation, so keep backups of important work.',
    },
    {
        id: 'custom-endpoint',
        question: 'Can I connect a self-hosted or custom model endpoint?',
        answer:
            'Yes, through the Custom OpenAI-Compatible provider. Supply an HTTPS base URL and a model identifier, and the endpoint must accept OpenAI-style chat completion requests. Agent features that use tool calling require the endpoint to support tool or function calling. Endpoints that require client certificates, a VPN, or a browser extension are not supported.',
    },
    {
        id: 'languages',
        question: 'Which languages can I run in the hosted workspace?',
        answer:
            'The hosted execution service supports Python, JavaScript, TypeScript, C, C++, Java, Ruby, PHP, Perl, Rust, Go, Swift, Lua, Bash, C#, Scala, and R. Compilers and runtimes are provided by the sandbox service, so exact versions can change. Execution is intended for learning, experiments, and small programs; it is not a production CI runner.',
    },
    {
        id: 'privacy',
        question: 'Does my code leave my device?',
        answer:
            'Yes, depending on the features you use. Signed-in workspaces and settings sync through Firebase. AI prompts and the code context you include are sent to your selected AI provider (BYOK) or to the Azemax backend (default mode). Code you run is sent to the hosted execution sandbox. Azemax does not sell your content, and the Privacy Policy describes the categories of data involved and the providers used. Do not paste secrets or regulated data into a tool you do not trust.',
    },
    {
        id: 'free',
        question: 'Is Azemax Studio free?',
        answer:
            'Azemax Studio is in public beta and is currently offered free of charge; no payment card is collected by Azemax. If you use Bring Your Own Key, your AI provider bills your account directly under its own terms. No paid plans or future pricing are announced on this website, so do not treat the current beta arrangement as a permanent price commitment.',
    },
    {
        id: 'offline',
        question: 'Can I use Azemax Studio offline?',
        answer:
            'No. The hosted product needs a network connection for sign-in, workspace sync, AI requests, and code execution. The browser may cache static assets, but that does not make the workspace usable offline.',
    },
    {
        id: 'delete-data',
        question: 'How do I delete my account or my data?',
        answer:
            'You can delete individual projects, files, and conversations in the workspace, and you can clear browser storage for the site. Full self-service account deletion is not implemented yet. To close an account and request deletion of server-side data, email azemaxhq@gmail.com from the address associated with the account with the subject “Account deletion”. Deletion is currently handled manually, and Firebase authentication records may need to be removed separately on request.',
    },
];
