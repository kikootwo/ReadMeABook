# Security Policy

## Supported Versions

Only the latest release of ReadMeABook gets security fixes. If you are on an older version, please update to the latest release first and check whether the problem still happens.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| Anything older | No |

## Reporting a Vulnerability

Please do not report security problems in a public issue, pull request, or Discord channel.

Report them privately through GitHub instead:

1. Go to the [Security tab](https://github.com/kikootwo/ReadMeABook/security) of this repo.
2. Click **Report a vulnerability**.
3. Fill in the form and submit it.

Only you and I can see the report, and I will work through it with you there until a fix is out.

## What to Include

The more of this you can give me, the faster I can confirm and fix it:

- **Version:** the ReadMeABook version you are running (shown in the app, or the image tag).
- **Deployment type:** unified Docker image, multi-container Docker, or something else (describe it).
- **Steps to reproduce:** what you did, in order, starting from a clean state if you can.
- **Impact:** what an attacker could do with it, and what access they need first (none, a regular user account, an admin account, network access to the container).
- Any proof of concept, logs, or screenshots. Please strip API keys, passwords and other credentials before sharing.

## What to Expect

- I will acknowledge the report and let you know whether I can reproduce it.
- I will keep you updated in the private report while I work on a fix.
- Fixes ship in a new release. Once it is out, I will publish an advisory and credit you unless you would rather stay anonymous.

I can't promise specific response or fix dates, but serious issues get priority over everything else.
