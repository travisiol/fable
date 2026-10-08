Build a complete web app called FABLE: an AI creator launchpad and creative Studio on Solana.
The product has two connected promises:
FOR FABLE HOLDERS:
“Hold FABLE. Create with AI.”
Eligible holders receive funded Studio credits to create characters, images and videos.
FOR CREATORS:
“Create a character. Launch its coin.”
Users create an original AI character, optionally launch its token, and receive a configured share of that token’s creator fees.
Make these benefits immediately understandable. Build the app, not just a promotional landing page.

1. PRODUCT CONCEPT
FABLE lets anyone turn a character idea into a virtual creator with:
* An original portrait.
* A name, biography and personality.
* A public creator page.
* An image and video gallery.
* An optional Solana token.
* A transparent content budget.
Example:
“A washed-up robot comedian broadcasting from a tiny apartment in Tokyo.”
The user describes the character, generates its identity, reviews the result and optionally launches its coin.
FABLE holders can use allocated Studio credits to create content.
Character creators can receive creator fees from their own launched tokens.
All virtual characters must be visibly labeled AI-generated.
FABLE is an independent brand. Create original designs, copy and assets without implying affiliation with other platforms.

2. EXPLAIN WHAT USERS GET
The homepage must clearly distinguish three benefits:
HOLD FABLE
Become eligible for Studio credits funded by verified platform fee receipts. Spend allocated credits on supported AI generations.
CREATE A CHARACTER
Build an original virtual identity and produce images or videos featuring it.
LAUNCH ITS COIN
Launch the character’s token through a verified integration and receive the configured creator share of its fees.
Holding FABLE alone does not give users ownership of the platform or another creator’s earnings.
A creator receives fees only when eligible trading activity generates them.
Do not make users read technical documentation to understand these benefits.

3. PROPOSED ECONOMIC MODEL
For supported character tokens launched through FABLE, the intended allocation of creator fees is:
* 30% funds the shared Studio credit pool for eligible FABLE holders.
* 40% funds that character’s own content budget.
* 30% goes to the character creator.
These percentages apply to creator fees received, not to the entire trading volume.
Before implementation, verify the current deployment platform’s fee-sharing capabilities.
If this allocation is unsupported, report the limitation and propose a supported alternative. Do not silently replace the model.
Do not show fee sharing as active until the integration is implemented and verified.
Keep the shared holder credit pool separate from each character’s content budget.
Track confirmed receipts, allocations, spending and remaining funds.
Do not add staking, buybacks, burns or other token mechanics unless required for this defined product.

4. STUDIO CREDIT ALLOCATION
Use a weekly allocation funded by confirmed receipts.
Eligibility and allocation should use average FABLE holdings over the previous week, rather than a balance checked only at claim time.
Make the minimum eligible balance, allocation formula and maximum allocation per wallet configurable.
Do not invent a deployed FABLE contract address.
The total cost of allocated credits must remain within the funded pool after accounting for outstanding credits and operating costs.
Users must see:
* Whether their wallet is eligible.
* Their available credits.
* The next allocation date.
* The published allocation rules.
* The estimated cost of each generation.
Do not promise unlimited generations or a fixed allowance that the budget cannot support.
If the pool has insufficient funds, show its actual status.
Generation failures must release or restore reserved credits without double refunds.
Refresh the user’s balance after completed jobs.

5. BRAND AND ART DIRECTION
Name: FABLE
Proposed platform token ticker: FABLE
Primary headline:
“Hold FABLE. Create with AI.”
Supporting sentence:
“Use Studio credits to bring original characters to life. Launch their coins on Solana.”
Launchpad headline:
“Create a character. Give it a coin.”
Visual direction:
A contemporary character studio and casting catalogue.
Palette:
* Warm ivory: #F4F1EA
* Almost black: #19171C
* Deep violet: #6547E8
* Pale lavender: #E7DFF8
Use expressive typography, generous spacing, thin separators and strong character portraits.
Make the interface feel creative and useful.
Avoid generic neon crypto dashboards, excessive gradients, decorative price charts and endless feature cards.
Logo:
A minimal square F monogram suggesting an open page.
No circular badge or border.
Promotional banners:
Never include the logo.
Use a short centered headline with character imagery.
All interface copy must be in clear English.

6. HOMEPAGE
Navigation:
FABLE / Explore / Studio / How it works / Connect wallet
Primary action:
“Start creating”
Secondary action:
“Launch a character”
HERO
Left:
“Hold FABLE. Create with AI.”
A short explanation of funded Studio credits and the optional character-token launch.
Right:
An expressive character portrait with its name and an “AI creator” label.
Show generation examples, not fabricated followers or earnings.
Immediately below:
“What do I get for holding FABLE?”
Show three concrete uses:
* Create an original character.
* Generate images and videos with allocated credits.
* Build a creator profile and optionally launch its coin.
Include a wallet panel:
FABLE balance / Eligibility / Available credits / Next allocation.
Before wallet connection, show explanatory placeholders.
Never display invented account balances.
CHARACTER CREATION ENTRY
Include a working description field:
“Who are you bringing to life?”
Use clearly labeled examples:
* A robot comedian.
* A retired space explorer.
* A dramatic pigeon food critic.
* A virtual fashion designer.
HOW IT WORKS
Explain two short journeys:
Holder:
Hold FABLE → Receive allocated credits → Create in Studio.
Creator:
Create a character → Launch its coin → Receive its creator share.
FUNDING EXPLANATION
Use a simple visual breakdown of the proposed 30% / 40% / 30% allocation.
Explain:
“Creator fees help fund new content.”
Distinguish proposed configuration from active, verified funding.
EXPLORE PREVIEW
Show real public characters when available.
Otherwise, use a small collection labeled “Example characters.”
Do not invent launch counts, volume, users, followers or revenue.

7. CHARACTER CREATION FLOW
Keep the flow focused:
Describe → Generate → Review.
Inputs:
* Character idea.
* Optional name.
* Personality.
* Visual style.
* Content niche.
Generate:
* Portrait.
* Suggested name.
* Short biography.
* Personality summary.
Allow editing and regeneration.
Show estimated generation cost before submission.
Preserve drafts.
After review, offer:
“Save character”
and
“Launch its coin”
Character creation must work independently of token deployment.

8. TOKEN LAUNCH FLOW
Use a short wizard:
Identity → Token → Review.
IDENTITY
Confirm the character portrait, name and biography.
TOKEN
Collect ticker, token description and optional social or website links.
Validate inputs against the actual deployment integration’s current limits.
REVIEW
Show:
* Network.
* Token metadata.
* Supported fee allocation.
* Deployment fees.
* Optional initial purchase.
* The transaction the wallet will sign.
Use the user’s wallet for signing.
Never request seed phrases or private keys.
Prevent duplicate deployment after retries.
Handle rejected signatures and transaction failures clearly.
Show success only after verifying transaction confirmation and the resulting mint.
If deployment is unavailable, disable the launch action and explain the missing configuration.
Do not redirect to an external site and present that as an integrated launch.

9. EXPLORE PAGE
Build a character catalogue with:
* Portrait.
* Name.
* Short biography.
* Content niche.
* AI-generated label.
* Token status.
Useful filters:
All / With a token / New characters.
Search by name or ticker.
Use real records.
Keep example characters distinguishable from live launches.
Do not rank characters by fabricated popularity.

10. PUBLIC CHARACTER PAGE
Make it feel like a creator profile.
Include:
* Portrait.
* Name and biography.
* Personality and niche.
* AI-generated label.
* Content gallery.
* Token information when deployed.
* Copyable contract address.
* Verified trade link.
* Character content budget.
* Recent funding and generation activity.
Show market data only from a real provider, with loading and unavailable states.
Explain the character’s funding:
“A configured share of this token’s creator fees funds its content.”
Do not imply that token holders own the character or receive its creator’s earnings.

11. STUDIO
Users select a saved character and create content.
Modes:
Image / Video.
Presets:
Portrait / New outfit / Scene / Talking clip.
Show:
* Character reference.
* Prompt.
* Output format.
* Estimated cost.
* Available credits or character budget.
* Generation progress.
* Result preview.
* Download action.
Clearly indicate which balance pays for the job.
Never charge both balances for one generation.
Use character-reference features where supported to preserve identity.
Do not claim perfect consistency if the provider cannot deliver it.
Store generation history and job status.
Handle failures, cancellations and retries.
Content generation does not automatically publish to social networks.

12. WALLET AND CREATOR DASHBOARD
Wallet overview:
* FABLE holdings.
* Credit eligibility.
* Available Studio credits.
* Allocation history.
* Generation spending.
Creator overview:
* Owned characters.
* Token deployment status.
* Confirmed creator fees received.
* Character budgets.
* Recent jobs.
* Funding activity.
Distinguish confirmed receipts from estimates.
Use empty states when no activity exists.
A connected wallet must prove ownership through a signed authentication challenge before accessing private creator controls.

13. IMPLEMENTATION REQUIREMENTS
Use a modern responsive web stack suitable for deployment on Vercel.
Implement:
* Persistent character records and drafts.
* Wallet authentication.
* Server-side AI provider calls.
* Asynchronous generation jobs.
* A credit ledger with reservations and refunds.
* Confirmed funding records.
* Public profiles.
* Verified token deployment when configured.
Check current official documentation before choosing blockchain, generation and market-data integrations.
Keep provider credentials and privileged operations server-side.
Use transaction-safe accounting so concurrent jobs cannot overspend a balance.
Make funding ingestion and job retries idempotent.
Long generation jobs must survive page refreshes and server request timeouts.
Provide useful mobile layouts, loading states, empty states and errors.

14. DEMO AND UNCONFIGURED STATES
Provide a clearly labeled demo mode for reviewing the interface.
Demo characters, balances, generations and transactions must never appear live.
If credentials are missing:
* Show the required configuration.
* Keep existing saved content accessible.
* Disable unavailable actions.
* Never fabricate completed generations, fee receipts or transactions.
Keep technical setup details in configuration screens and documentation.
Keep the main user experience focused on creating characters and using credits.

15. BUILD ORDER AND VALIDATION
Prioritize:
1. Character creation and persistent profiles.
2. Real image generation.
3. Studio credit accounting.
4. Verified token deployment.
5. Fee receipt ingestion and weekly allocations.
6. Video generation.
Validate:
* A real character-generation workflow.
* Persistence after refresh.
* Credit reservation, spending and failure refund.
* Rejected and failed wallet transactions.
* Duplicate-request handling.
* A configured launch from signing through confirmation.
* Allocation totals that cannot exceed funded capacity.
At delivery, list:
* What is functional.
* Required credentials and configuration.
* Integrations still incomplete.
* Validation performed.
The finished product should let a visitor answer immediately:
“What do I get for holding FABLE?”
“What can I create?”
“How does launching my character’s coin work?”
