import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <Image src="/logo2.png" alt="VaultProof" width={40} height={40} />
        </div>
        <div className="flex items-center gap-6">
          <Link href="/keys" className="text-sm text-gray-400 hover:text-white transition">
            Dashboard
          </Link>
          <Link
            href="/keys"
            className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 hover:shadow-[0_0_16px_rgba(99,102,241,0.4)] hover:-translate-y-px transition-all duration-200 px-4 py-2 rounded-lg text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-8">
          <span className="text-xs font-medium text-indigo-400">
            39M secrets leaked on GitHub in 2024. We fix that.
          </span>
        </div>

        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-tight mb-6">
          The only API key vault where{" "}
          <span className="text-indigo-400">even we can&apos;t see your keys</span>
        </h1>

        <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10">
          Shamir secret sharing splits your key the instant you enter it.
          Zero-knowledge proofs authorize every access. Your key never exists
          whole on any server.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/keys"
            className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-[0_0_0_0_rgba(99,102,241,0)] hover:shadow-[0_0_24px_rgba(99,102,241,0.45)] hover:-translate-y-px transition-all duration-200 px-6 py-3 rounded-xl font-semibold text-base text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Store Your First Key
          </Link>
          <a
            href="#how-it-works"
            className="border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white hover:bg-white/5 transition-all duration-150 px-6 py-3 rounded-xl font-semibold text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            How It Works
          </a>
        </div>
      </section>

      {/* Stats bar */}
      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { stat: "39M", label: "Secrets leaked on GitHub (2024)" },
            { stat: "81%", label: "Surge in AI credential leaks" },
            { stat: "$4.88M", label: "Avg cost of credential breach" },
            { stat: "64%", label: "Leaked secrets never revoked" },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <div className="text-3xl font-bold text-indigo-400">{item.stat}</div>
              <div className="text-xs text-gray-500 mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: "\u2702",
              title: "1. Key is split instantly",
              desc: "You paste your API key. It's immediately split into two shares using Shamir Secret Sharing. The full key is destroyed. This happens in your browser -- it never leaves your device whole.",
            },
            {
              icon: "\uD83D\uDD12",
              title: "2. Shares stored separately",
              desc: "Share 1 goes to our vault (encrypted). Share 2 stays on your device. Neither share alone reveals anything -- half a key is cryptographic garbage.",
            },
            {
              icon: "\u26A1",
              title: "3. Ephemeral reconstruction",
              desc: "When you need to make an API call, a zero-knowledge proof authorizes the request. Shares combine for ~100ms, the call is made, memory is zeroed.",
            },
          ].map((step) => (
            <div key={step.title} className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="text-3xl mb-4">{step.icon}</div>
              <h3 className="text-lg font-bold mb-2">{step.title}</h3>
              <p className="text-sm text-gray-400">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">vs Every Other Secrets Tool</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-3 px-4 text-gray-400 font-medium">Product</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">Can see your key?</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">ZK Proofs?</th>
                <th className="text-center py-3 px-4 text-gray-400 font-medium">Key Splitting?</th>
              </tr>
            </thead>
            <tbody>
              {[
                "HashiCorp Vault",
                "1Password",
                "AWS Secrets Manager",
                "Infisical",
                "Doppler",
                "OpenRouter (BYOK)",
              ].map((name) => (
                <tr key={name} className="border-b border-gray-800/50">
                  <td className="py-3 px-4 text-gray-300">{name}</td>
                  <td className="py-3 px-4 text-center text-red-400">Yes</td>
                  <td className="py-3 px-4 text-center text-red-400">No</td>
                  <td className="py-3 px-4 text-center text-red-400">No</td>
                </tr>
              ))}
              <tr className="border-b border-indigo-500/30 bg-indigo-500/5">
                <td className="py-3 px-4 font-bold text-indigo-400">VaultProof</td>
                <td className="py-3 px-4 text-center text-green-400 font-bold">Never</td>
                <td className="py-3 px-4 text-center text-green-400 font-bold">Yes (Noir)</td>
                <td className="py-3 px-4 text-center text-green-400 font-bold">Yes (Shamir)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Breaches */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-4">Breaches We Would Have Prevented</h2>
        <p className="text-center text-gray-500 mb-12">Half a key is cryptographic garbage.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { company: "Toyota", detail: "API key on GitHub for 5 years", impact: "296K customer records" },
            { company: "Uber", detail: "Hard-coded credentials in repo", impact: "57M records compromised" },
            { company: "Twitch", detail: "6,600 secrets in leaked source", impact: "194 AWS keys, 69 Twilio keys" },
            { company: "CircleCI", detail: "All customer secrets stolen", impact: "Every customer rotated everything" },
            { company: "Codecov", detail: "Supply chain key extraction", impact: "23K+ customers for 2+ months" },
            { company: "xAI", detail: "SpaceX/Tesla LLM key on GitHub", impact: "2 months of unauthorized access" },
          ].map((b) => (
            <div key={b.company} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-3">
              <div className="text-red-400 text-lg mt-0.5">&#9888;</div>
              <div>
                <div className="font-bold text-white">{b.company}</div>
                <div className="text-sm text-gray-400">{b.detail}</div>
                <div className="text-xs text-red-400 mt-1">{b.impact}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Code example */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-4">One Component. Zero Trust.</h2>
        <p className="text-center text-gray-500 mb-10">Drop our widget into any app.</p>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 font-mono text-sm overflow-x-auto">
          <div className="text-gray-500">{"// npm install @vaultproof/connect"}</div>
          <br />
          <div>
            <span className="text-purple-400">import</span>
            <span className="text-gray-300">{" { "}</span>
            <span className="text-yellow-300">ZKKeyConnect</span>
            <span className="text-gray-300">{" } "}</span>
            <span className="text-purple-400">from</span>
            <span className="text-green-400">{" '@vaultproof/connect'"}</span>
          </div>
          <br />
          <div className="text-gray-300">{"<"}<span className="text-yellow-300">ZKKeyConnect</span></div>
          <div className="text-gray-300 pl-4">{"vaultUrl="}<span className="text-green-400">{'"https://api.vaultproof.dev"'}</span></div>
          <div className="text-gray-300 pl-4">{"appId="}<span className="text-green-400">{'"my-app-123"'}</span></div>
          <div className="text-gray-300 pl-4">{"appName="}<span className="text-green-400">{'"My AI App"'}</span></div>
          <div className="text-gray-300 pl-4">{"userId={user.id}"}</div>
          <div className="text-gray-300 pl-4">{"providers={['openai', 'anthropic']}"}</div>
          <div className="text-gray-300">{"/>"}</div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Pricing</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div className="text-lg font-bold mb-1">Free</div>
            <div className="text-3xl font-extrabold mb-4">$0<span className="text-sm text-gray-500 font-normal">/mo</span></div>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>3 key slots</li>
              <li>1,000 proxied calls/mo</li>
              <li>1 app grant per key</li>
            </ul>
          </div>
          <div className="bg-gray-900 border-2 border-indigo-500 rounded-2xl p-6 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>
            <div className="text-lg font-bold mb-1">Pro</div>
            <div className="text-3xl font-extrabold mb-4">$12<span className="text-sm text-gray-500 font-normal">/mo</span></div>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>20 key slots</li>
              <li>50K proxied calls/mo</li>
              <li>Unlimited app grants</li>
              <li>Usage analytics</li>
            </ul>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <div className="text-lg font-bold mb-1">Team</div>
            <div className="text-3xl font-extrabold mb-4">$39<span className="text-sm text-gray-500 font-normal">/mo</span></div>
            <ul className="space-y-2 text-sm text-gray-400">
              <li>100 key slots</li>
              <li>200K proxied calls/mo</li>
              <li>Team sharing + SSO</li>
              <li>Audit log export</li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">Stop trusting. Start proving.</h2>
        <p className="text-gray-500 mb-8">Breaches are architecturally impossible, not just policy-prohibited.</p>
        <Link href="/keys" className="inline-block bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-[0_0_0_0_rgba(99,102,241,0)] hover:shadow-[0_0_24px_rgba(99,102,241,0.45)] hover:-translate-y-px transition-all duration-200 px-8 py-4 rounded-xl font-semibold text-lg text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950">
          Get Started Free
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-8 px-6 text-center text-sm text-gray-600">
        VaultProof by <a href="https://vaultproof.dev" className="text-gray-400 hover:text-white transition">VaultProof</a> &mdash; Zero-knowledge API key infrastructure
      </footer>
    </div>
  );
}
