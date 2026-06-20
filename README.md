# SurplusSync Copilot Laboratory

This is the independent **AI Operations Copilot subsystem** designed for the **USAII Global AI Hackathon 2026 High School Track**, under the environmental category **Make Climate Action Local and Real — Food Waste Rescue Radar**.

The application serves as a standalone Copilot Laboratory built on React, TypeScript, and the modern `@google/genai` TypeScript SDK. It demonstrates how Gemini can act as a transparent assistant to explain predictions, handle simulations, draft partner reservation alerts, suggest route modifications, and evaluate policy safety floors—all while maintaining robust human-in-the-loop controls.

---

## Technical Architecture Overview

The subsystem is decoupled into logical modules that can easily be integrated into any other React dashboard repository:

1. **`src/types.ts`**: Formal parameters mapping the strict structured schemas (`StructuredCopilotResponse`, `AIActionProposal`, `AuditEntry`, `UserRole`, etc.).
2. **`src/copilot/systemPrompt.ts`**: The operational instructions enforcing rigorous vocabulary, safety refusal policies, role permission matrices, and enforcing strict JSON responses.
3. **`src/copilot/permissionPolicy.ts`**: Hardcoded deterministic state permission checking rules evaluated in real-time.
4. **`src/copilot/mockGeminiClient.ts`**: Deterministic simulation engine demonstrating perfect, high-fidelity operations even without a Gemini API Key.
5. **`server.ts`**: A secure full-stack Express & Vite gateway proxying API calls to prevent API keys from leaking to client-side bundles.

---

## How to Run the Laboratory Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variable
Create a `.env` in the root and configure your key securely:
```env
GEMINI_API_KEY="YOUR_KEY_HERE"
```
*(If no key is configured, the Copilot seamlessly falls back to high-fidelity mock offline mode automatically!)*

### 3. Start the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### Canonical ML contract (Phase B)

When `ML_SERVICE_URL` points at the SurplusSync ML service with `ALLOW_DEMO_FIXTURE=true`:

| Scenario | expectedAttendance | interval | recommendedPrep | preventableSurplus | shortageProb | risk |
|----------|-------------------|----------|-----------------|-------------------|--------------|------|
| Baseline forecast | 528 | 497–557 | 562 | 168 | 0.041 | high |
| Trip-cancelled what-if | 540 | 512–568 | 575 | 155 | 0.034 | high |

Both responses keep `decisionStatus: PROPOSED`, `approvalRequired: true`, and `safetyFloorApplied: true`.
The corrected what-if safety buffer is **7 meals** (575 − 568). Live ML and canonical fallback return
identical contract fields; provenance discloses `ml` vs `local-canonical-fallback`.

Example what-if request: `examples/what_if_request.json` in the ML service repository (mirrored in
`buildCanonicalTripCancelledChanges()`).

---

## Integration Blueprint (Connecting to Main App)

To copy this Copilot to another React app, migrate the `src/copilot` and `src/components` folders directly. 
Submit requests to the backend server-side endpoint via standard REST API requests:

```typescript
// Query the copilot endpoint from your UI:
const response = await fetch("/api/copilot", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Why is Thursday marked as high risk?",
    role: "CAFETERIA_MANAGER",
    currentPlan: 730,
    schoolState: schoolStatePayload,
    forecastState: forecastStatePayload,
    partnersState: partnersPayload
  }),
});
const data = await response.json();
console.log(data.result); // Returns strict StructuredCopilotResponse
```
