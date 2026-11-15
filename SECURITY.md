# Security

banda runs agents that act on your behalf, so its boundaries matter: the box (the agent's computer), the egress proxy
(the only way out, which adds credentials and holds writes for you), drafts and permissions (what may run without
asking), and the browser. [DESIGN.md](DESIGN.md) states the rules; [docs/README.md](docs/README.md) tracks the open
isolation, egress and browser findings. It is a first release: do not rely on it to contain untrusted code or content yet.

## What 0.1.0 does not protect

All your agents share one computer. It is a virtual machine apart from your own files, and its only way out is the
proxy, but inside it nothing separates one agent or chat from another:

- Code an agent runs can read and change the other agents' files there, their memory included.
- A command goes out through the proxy under its chat's login, and a process in the computer can read another chat's
  login. So a site you allowed for one agent can be sent to by code any of your agents runs: the permission is tied
  to the login, not to a boundary the agent cannot cross.

What is kept outside the computer is not exposed by this: your model sign-ins, your connections' credentials, the
chats themselves and the rest of your machine. A computer for each agent would close it and is future work
([docs/isolation.md](docs/isolation.md)). Until then, allow a site for one agent only if you would allow it for all
of them. `serve --box host` has no computer at all: commands run on your own machine.

The Mac app is not signed with an Apple Developer ID and not notarized, and banda does not update itself: check a
download against the release's `SHA256SUMS`, and install updates by hand.

A browser you pair at app.banda.rocks runs the files that address serves, each time it opens. Whoever controls that
address, its host or its domain's records, can serve other files, and a paired browser acts as you. The phone's app
is installed once and does not change under you; pair a browser only if you accept that difference. The key that
makes the browser your device sits in that browser's storage unsealed: a script that address serves has it, and so
does a copy of the browser's profile, where the phone's app keeps its key in the phone's keystore. The link you pair
with may stay in the browser's history; its code works once, for ten minutes. Everything a paired browser sends
passes n0's relay, encrypted end to end, where the phone's app also reaches your computer directly.

## Reporting

Please report a vulnerability privately through GitHub's
[private vulnerability reporting](https://github.com/purrgrammer/banda/security/advisories/new) rather than a public
issue. Include what you did, what you expected and what happened; a reproduction against a throwaway home
(`BANDA_HOME=$(mktemp -d)`) helps most. You will get an answer as soon as we can, and credit if you want it.

Findings already listed under a section's **Open work** in `docs/` are known; a new way to exploit one is still welcome.
