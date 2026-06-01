# Auth for MCP Demo Video Script (3-Minute Cut)

**Target runtime:** 3:00 (~390 words at ~130 wpm)
**Feature focus:** Auth for MCP by Auth0
**Demo context:** RetailZero (reference MCP server)
**Narrative angle:** Lead with the end-user experience inside Claude, then surface the Auth0 dashboard moments that prove the experience is production-grade and ready to ship.

---

## [0:00 – 0:20] Intro: The Experience Your Customers Will Feel

**VISUAL:** Title card "Auth for MCP by Auth0" dissolves into b-roll of a customer chatting with Claude. Quick cut to the RetailZero storefront.

**VO:**

> The agentic experiences your customers are about to live with run on identity decisions made long before the first prompt. Auth for MCP gives your team the building blocks to ship those experiences with confidence, so you can move from concept to customer in weeks rather than quarters. Let me show you what that looks like from the user's seat.

---

## [0:20 – 0:50] Claude First: Discovery and Browse

**VISUAL:** Full screen of Claude's web interface. Mark is signed in. Prompt: *"Hello, what products do you have in stock today?"* Claude discovers the RetailZero tools and returns the catalog inline. Brief 3-second splash to the Auth0 dashboard showing Claude listed as a registered application, with a callout on the resource identifier the request carries. Cut back to Claude.

**VO:**

> I am signed into Claude as a customer named Mark, and I ask what RetailZero has in stock today. Claude discovers the tools, calls the catalog, and returns the products inline. Behind the scenes, Auth0 already knows Claude. The platform team registered it once using a Client ID Metadata Document, and Auth0 now honors the MCP specification's resource identifier natively, so your implementation stays spec-compliant without the workarounds or translation layers your team would otherwise have to build and maintain.

---

## [0:50 – 1:35] Claude Continues: Add to Cart

**VISUAL:** Same Claude window. Prompt: *"Please add a linen shirt set to my cart."* Claude confirms the cart and the price. Brief 3-second splash to the Auth0 dashboard showing the **On-Behalf-Of Token Exchange** toggle enabled on the confidential client, then back to Claude.

**VO:**

> Next, I ask Claude to add a linen shirt set to my cart, which is the kind of action that should only ever happen with my permission and never with the agent's elevated privileges. The cart updates and Claude confirms one hundred and forty-five dollars. The reason this is safe is configured once in Auth0. On-Behalf-Of token exchange swaps the agent's token for one scoped to my permissions before it ever touches the resource layer. Least privilege is enforced at the token, not in code your team has to maintain.

---

## [1:35 – 2:35] Claude Closes the Loop: Checkout with a Human in the Loop

**VISUAL:** Claude window. Prompt: *"I'm ready to check out."* Cut to a phone showing the Guardian push notification with order details. Mark approves. Back to Claude, where the order confirms. Brief 2-second splash to the Auth0 dashboard showing CIBA configuration, then back to the order confirmation.

**VO:**

> Now I tell Claude I am ready to check out. This is a high-value action, so the server pauses the agent and pushes the transaction details to my phone for approval. I review the order, approve it, and Claude completes the checkout. That handoff is Client-Initiated Backchannel Authentication, configured once in Auth0 and reusable across every agent your business connects. The customer stays in control of the moments that matter, while the agent handles everything else.

---

## [2:35 – 3:00] Conclusion: Ship Confidently, Spend Less

**VISUAL:** Cut back to the Auth for MCP title card. Auth0 and RetailZero logos.

**VO:**

> That is Auth for MCP from the customer's seat and from the platform team's. Registration, scoped permissions, and human-in-the-loop approvals are configured once and reused across every agent you ship. The result is engineering effort redirected to product innovation, lower operational overhead from centralized policy enforcement, and a faster path from concept to launch. Auth for MCP is available today on Auth0.

---

## Production notes

- **Structure shift:** Claude is the lead frame for every section. Dashboard splashes are short cuts (2 to 3 seconds each) that show the configuration backing the experience the viewer just saw. Never linger on the dashboard.
- **Word count:** ~390 words at 130 wpm. Per-section pacing: intro 0:20, discovery 0:30, add-to-cart 0:45, checkout 1:00, conclusion 0:25.
- **Lower-thirds to flash during dashboard splashes:** "CIMD, Client ID Metadata Document" and "MCP Resource Identifiers, native support" (during discovery splash), "On-Behalf-Of Token Exchange, RFC 8693" (during add-to-cart splash), "CIBA, Client-Initiated Backchannel Authentication" (during checkout splash).
- **Key phrases to land:** "from the user's seat", "configured once and reused across every agent", "least privilege is enforced at the token, not in code", "spec-compliant without workarounds or translation layers", "from concept to customer in weeks rather than quarters".
- **Demo hygiene:** Pre-clear Mark's cart, pre-pair the Guardian device, and pre-load the storefront so Claude's responses feel snappy. Have the dashboard tabs queued in a second browser window so each splash is a clean cut rather than a navigation sequence.
