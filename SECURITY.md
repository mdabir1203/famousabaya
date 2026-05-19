## 2. Scope of Vulnerabilities

To ensure high-signal triage and mutual efficiency, please align your research with the following scope definitions.

### **In-Scope (Critical & High Impact)**
* Remote Code Execution (RCE)
* Significant Authentication/Authorization bypass
* Cross-Site Scripting (XSS) with demonstrable user impact
* Server-Side Request Forgery (SSRF)
* Cryptographic failures or sensitive data exposure

### **Out-of-Scope (Do Not Report)**
* Denial of Service (DoS / DDoS) attacks
* Spam, social engineering, or physical facility penetration testing
* Missing security headers without a demonstrable exploit path
* Vulnerabilities in third-party dependencies not actively exploitable within our environment

## 3. Vulnerability Reporting Protocol

We have designed our intake process to be frictionless and secure. 

**Where to Report:**
Please submit all findings directly via email to `official@getwaved.ai`. For highly sensitive vulnerabilities, please encrypt your payload using our public PGP key.

**What to Include:**
To expedite triage, structure your report using the following parameters:
1.  **Vulnerability Type:** (e.g., Stored XSS, Privilege Escalation).
2.  **Affected Component:** The exact URL, API endpoint, or file path.
3.  **Proof of Concept (PoC):** A step-by-step, reproducible breakdown of the exploit. Include benign scripts, HTTP requests, or video recordings if applicable.
4.  **Impact Assessment:** A realistic evaluation of what a malicious actor could achieve.
5.  **Suggested Mitigation:** (Optional) Your technical recommendation for resolving the flaw.

## 4. Our Commitment & Incident Response SLA

We recognize the effort required to identify vulnerabilities. You can expect the following definitive timelines and actions from our security team, operating within **Gulf Standard Time (GST)**:

* **Initial Acknowledgment:** Within 24 hours of submission.
* **Triage & Validation:** Within 72 hours, we will confirm the validity of the report and determine its severity.
* **Resolution Strategy:** Within 7 days, we will provide an estimated timeline for the patch deployment.
* **Status Updates:** We will provide proactive updates every 14 days until the issue is fully resolved.
* **Recognition:** Upon remediation, and with your explicit consent, we will attribute your finding in our release notes and submit a coordinated CVE request naming you as the discoverer. 

## 5. Safe Harbor & Jurisdiction

We consider ethical security research to be a vital public good. Provided you comply with the guidelines set forth in this policy—specifically avoiding data destruction, privacy violations, and service disruption—we consider your activities to be authorized and in good faith. 

In alignment with **UAE Federal Decree-Law No. 34 of 2021 on Countering Rumors and Cybercrimes**, we will not initiate legal action, file complaints with Dubai Police or the Dubai Electronic Security Center (DESC), or launch law enforcement investigations against researchers who submit reports adhering to this coordinated disclosure policy.
