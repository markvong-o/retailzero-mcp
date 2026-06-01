# Auth for MCP Demo Video Script

**Target runtime:** 6:06 (~795 words at ~130 wpm, slightly below average pace). Section timings calibrated to actual recorded footage.
**Feature focus:** Auth for MCP by Auth0
**Demo context:** RetailZero (reference MCP server)

---

## [0:00 – 0:15] Intro

**VISUAL:** Title card "Auth for MCP by Auth0" over b-roll of the retailzero storefront, then cut to speaker or screen.

**VO:**

> Almost every MCP server hits the same identity wall. Authenticating AI clients, scoping agent actions, and keeping humans in the loop are tough problems to tackle. Auth0's Auth for MCP closes that gap out of the box. Let's take a look at how it can do that.

---

## [0:15 – 1:12] Auth0 Dashboard: CIMD Application for Claude

**VISUAL:** Auth0 dashboard, Applications list. Click **Create Application**. Highlight the new **Import from URL** option. Paste Claude's CIMD URL into **Client ID Metadata URL**. Click **Preview**, showing the JSON with `external client id`, `name`, `callbacks`, `grant_types`, `app_type`, `token_endpoint_auth_method`. Click **Save**. Cut to the newly created Claude application. Scroll through application properties and application URIs. Scroll back up, click the **APIs** tab, showing Retail MCP Tools with all permissions granted for both user and client access. Click the **Connections** tab.

**VO:**

> First, client registration.
>
> In the Auth0 dashboard, I click Create Application and use the new Import from URL option. I paste Claude's Client ID Metadata Document URL, click Preview, and Auth0 fetches the document and renders the client config: external client ID, name, callbacks, grant types, application type, and token endpoint auth method. One click to save, and Claude is registered.
>
> Scrolling through the application, the APIs tab shows Retail MCP Tools already has permissions granted for both user and client access by default, and Connections uses domain-level configuration, so there's no per-application wiring either.

---

## [1:12 – 3:36] Auth0 Dashboard: On-Behalf-Of Token Exchange

**VISUAL:** Navigate to **APIs**. Click **RetailZero MCP Tools**. Scroll to show RBAC Settings, Access Settings, Application Access Policy, and the new **Default Permissions for Third-Party Applications** section (set to "all" for both user and client access). Flash the description. Scroll up, click **Permissions** (show MCP tool call scopes). Click **Application Access** (Claude listed with permissions auto-granted). Click back, open **RetailZero Resource Server** API. Scroll to Default Permissions for third-party apps, now set to **Unauthorized** for both user and client. Hold ~5 seconds. Click **Permissions** (resource server scopes). Click **Application Access** (Claude has no permissions here). Navigate back to **RetailZero MCP Tools**. Click **Create Application** (upper right). Name: `RetailZero MCP Tools Confidential Client`. Show the description callout referencing Token Vault, MCP Servers, and downstream API calls. Click **Add**. Scroll through the new client: Client ID, Client Secret, Application Properties (first-party ownership, Custom API Client). Stop on **Token Exchange** section, read the toggle description, enable **On-Behalf-Of Token Exchange**, click **Save**. Quickly flash Advanced Settings, App Metadata, and Grant Types (only Client Credentials and Token Vault). Scroll up, click **API Access**. Grant user-delegated access to the Resource Server permissions. Click **Save**.

**VO:**

> Client registration is only half the picture. What the agent can do once authenticated is the other half, and this is where the permission model matters.
>
> I'll open RetailZero MCP Tools under APIs. The new section at the bottom is Default Permissions for Third-Party Applications. Third-party clients like Claude, ChatGPT, and Gemini always need permissions explicitly selected, and whatever you set here becomes the default unless Application Access overrides it. I've granted everything for both user and client access. The Permissions tab lists the individual tool scopes, and in Application Access, Claude is already provisioned.
>
> Now the RetailZero Resource Server API. Same controls, but Default Permissions is set to Unauthorized. The resource server holds the raw data, and no agent should reach it directly. Application Access confirms Claude has no access. The agent only calls the MCP Tools facade, never the resource layer.
>
> So how does the server reach the resource layer on the user's behalf? Back on MCP Tools, I click Create Application and add a RetailZero MCP Tools Confidential Client. This is a middle-tier client that is used exclusively to communicate with RetailZero's resource server.
>
> Once created, I open Token Exchange and enable On-Behalf-Of Token Exchange. This toggle authorizes the client to swap a user's token for a new one with a different audience, reaching downstream APIs with the user's scoped permissions rather than its own. Grant Types confirms the restricted surface: only Client Credentials and Token Vault. In API Access, I grant user-delegated access to the Resource Server's permissions and save.
>
> This guarantees that least privilege is enforced at the token layer, not in application code.

---

## [3:36 – 5:36] Claude Interface: End-to-End MCP Flow

**VISUAL:** Split-pane Chrome window. Left: Claude web UI. Right: live RetailZero server log panel scrolling security events in real time. Signed in as Mark. Each prompt below runs sequentially in the same Claude conversation.

**VO (intro to segment):**

> Now let me walk you through an end-to-end flow. I've split the browser into two panes: Claude's web interface on the left, and RetailZero's live server log on the right, streaming every security event as it fires. I'm signed in as Mark.

### Show catalog

**Prompt:** *"Hello, what products do you have in stock today?"*

**VISUAL:** Claude discovers the retailzero tools. Right pane shows token verification, tool discovery, and the `search_products` call. Claude returns all ten catalog items.

**VO:**

> I start simple. What products do you have in stock today? Claude discovers the RetailZero toolset, verifies the bearer token, and calls search_products. The handshake lands in the log pane on the right, and Claude renders the full catalog, all ten items.

### Add to cart

**Prompt:** *"Please add a linen shirt set to my cart."*

**VISUAL:** Log pane shows three events in sequence: **token verified**, **On-Behalf-Of token exchange**, **add_to_cart**. Claude confirms the cart and the total.

**VO:**

> Next, I ask Claude to add a linen shirt set to my cart. This is a write, not a read. Watch the log pane closely: token verified, On-Behalf-Of exchange completes, then add_to_cart fires against a freshly scoped downstream token. Claude confirms the shirt is in my cart with a total of one hundred and forty-five dollars.

### View cart

**Prompt:** *"What's currently in my cart?"*

**VISUAL:** Same log sequence: token verify, exchange, `view_cart`. Claude returns cart contents.

**VO:**

> Asking what's in my cart runs the same pattern: verify, exchange, view_cart. One item, one forty-five. The scope in that exchanged token is bounded to Mark's resources, which means cross-tenant leakage isn't just unlikely, it isn't representable in the auth model.

### Checkout with CIBA

**Prompt:** *"I'm ready to check out."*

**VISUAL:** Log pane shows CIBA push initiated. Cut to Guardian notification on phone with transaction details (item, price, merchant). Tap approve. Cut back to split pane showing CIBA approval event, step-up token minted, and `complete_checkout` call. Claude confirms the order.

**VO:**

> Now checkout. This transaction exceeds the bounded authority we set for autonomous agent actions, so instead of completing silently, the server triggers Client-Initiated Backchannel Authentication. Auth0 pushes the transaction details to my device, I approve, and on the right pane you can see the backchannel flow complete: a step-up token is minted, complete_checkout fires against the payment API, and the order confirms.
>
> The agent did all the work. I authorized the risk. That separation of duties is built into Auth for MCP rather than bolted on afterwards.

---

## [5:36 – 6:06] Conclusion

**VISUAL:** Cut back to speaker or Auth for MCP title card. Logos for Auth0 and RetailZero.

**VO:**

> And that's Auth for MCP end to end. By folding Client ID Metadata Documents, On Behalf of token exchange, and CIBA into a single integration, Auth0 gives platform teams the identity layer for agentic applications out of the box, which translates directly into a quarter of engineering effort avoided and a shorter runway to production. Auth for MCP is available today on Auth0. Thanks for watching.

---

## Production notes

- **Word count:** ~795 words → ~6:05 at 130 wpm. Section timings calibrated to recorded footage: intro 0:15, CIMD 0:57, OBO 2:24, Claude demo 2:00, conclusion 0:30. Total 6:06. Per-section VO word counts are tuned so the speaker can read naturally without racing the visuals.
- **Lower-thirds to flash:** "CIMD, Client ID Metadata Document", "Token Exchange, RFC 8693", "CIBA, Client-Initiated Backchannel Authentication (OIDC)".
- **Key phrases to land clearly:** "Auth for MCP", "no records to manage, no secrets to rotate", "least privilege at the token layer", "a CISO will actually sign off on".
- **Pacing adjustment:** The two Auth0 dashboard clips are dense. Slow 10% during those segments and tighten cuts in the Claude demo to keep rhythm.
- **Demo hygiene:** Pre-clear Mark's cart, pre-approve the Guardian device pairing, pre-load the storefront data so tool responses feel snappy on camera. Position the browser split so the log pane captures the full event card height without scrolling mid-response.
