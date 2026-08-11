# SOFTWARE LICENSE AGREEMENT

**IMPORTANT – READ CAREFULLY:** This Software License Agreement ("Agreement") is a legal agreement between the client entity ("Licensee") and the licensor of AbaYa Track ("Licensor"). By installing, copying, or otherwise using the Software, you agree to be bound by the terms of this Agreement.

## 1. GRANT OF LICENSE
Subject to the terms and conditions of this Agreement, Licensor hereby grants to Licensee a non-exclusive, non-transferable, limited right and license to use the AbaYa Track software ("Software") solely for Licensee’s internal business operations.

## 2. RESTRICTIONS
Licensee shall not:
a) Modify, translate, reverse engineer, decompile, or disassemble the Software.
b) Rent, lease, lend, or distribute the Software to any third party.
c) Remove any proprietary notices or labels on the Software.
d) Use the Software to provide services to third parties (e.g., as a service bureau).

## 3. OWNERSHIP AND INTELLECTUAL PROPERTY
The Software is licensed, not sold. Licensor retains all right, title, and interest in and to the Software, including all related intellectual property rights. This Agreement does not grant Licensee any rights to trademarks or service marks of Licensor.

## 4. FEES, TRIAL PERIOD, AND USAGE-BASED LICENSING

**4.1 Usage-based model.** Licensor provides the Software and related cloud services on a **usage-based** basis. Access, features, and fair-use limits are measured against documented usage units recorded by the Software (including, without limitation: material-dispatch invoices processed, floor work sessions tracked, connected tablets, CEO dashboard access, and optional add-ons such as customer WhatsApp notifications). Usage meters and tier thresholds are described in the applicable **Order Form** or **Schedule A** signed by both parties and, where applicable, in [SLA_SLO.md](SLA_SLO.md).

**4.2 Six-month free service period.** From the **Service Start Date** (the date Licensor confirms production deployment or first productive use by Licensee, whichever is earlier), Licensee may use the Software and included services **at no charge for six (6) consecutive calendar months** ("Free Service Period"). During the Free Service Period, Licensor will not invoice Licensee for subscription or usage fees; optional third-party costs (e.g., Meta WhatsApp Business fees, SMS, or hardware) remain Licensee’s responsibility unless otherwise agreed in writing.

**4.3 Annual charges after the Free Service Period.** Upon expiry of the Free Service Period, continued use of the Software requires payment of an **annual subscription fee** ("Annual Fee"), billed **once per year in advance**, unless the parties agree otherwise in writing. The Annual Fee corresponds to the usage tier and entitlements set out in the Order Form / Schedule A. Licensor will issue an invoice at least **thirty (30) days** before the first Annual Fee is due. Failure to pay the Annual Fee when due may result in suspension or termination under Section 9.

**4.4 Usage in excess of tier.** If Licensee’s measured usage exceeds the limits of the subscribed tier during a billing year, Licensor may (a) charge overage fees at the rates in the Order Form / Schedule A, or (b) require Licensee to upgrade to a higher tier for the remainder of that year, at Licensor’s reasonable discretion with prior written notice.

**4.5 Taxes.** All fees are exclusive of applicable VAT and other taxes unless stated otherwise. Licensee is responsible for any taxes imposed on its purchase, excluding taxes based on Licensor’s net income.

**4.6 No refunds.** Except where required by applicable law, Annual Fees and overage charges are **non-refundable** once the billing period has begun.

**4.7 Service conditional on licensee maintenance.** Licensor’s obligation to provide the Software, cloud sync, remote support, and any SLA-backed service (including during the Free Service Period and after payment of the Annual Fee) applies **only while Licensee maintains the factory host and network in a state suitable for reliable operation** ("Minimum Operating Requirements"). If Licensee fails to meet these requirements, Licensor may suspend support, exclude incidents from SLA uptime calculations (see [SLA_SLO.md](SLA_SLO.md) §7), and is not obligated to remedy outages caused solely by Licensee neglect.

Licensee shall ensure that, during factory operating hours and whenever floor tablets or cloud sync are expected to be active:

a) **Power and session** — the designated factory laptop (or PC) is **powered on**, logged in, and not left in sleep, hibernate, or shutdown state during scheduled production.

b) **Network** — **Wi‑Fi (or wired LAN) is connected** to the **factory network specified in the Order Form / deployment documentation**, with stable internet access where cloud features are enabled, and without unauthorized network changes that block LAN or tunnel traffic.

c) **Software running** — the AbaYa Track **server processes and operator interfaces are running properly** (including PM2-managed services, kiosk/dashboard availability on the LAN, and any required tunnel or dispatch services as deployed by Licensor).

d) **Storage** — the factory host **hard disk retains sufficient free space** for logs, SQLite snapshots, and ingest queues (Licensor recommends **at least 10 GB free** at all times; Licensor may specify a higher minimum in Schedule A).

e) **Monthly restart** — Licensee **restarts the factory laptop at least once per calendar month** (full reboot, not sleep/wake) for cache and system maintenance, at a time agreed with Licensor or during a scheduled maintenance window.

Licensee shall notify Licensor promptly of any planned power outage, network change, or hardware replacement that may affect compliance. Licensor may provide a written checklist of Minimum Operating Requirements; that checklist is incorporated by reference when issued to Licensee.

## 5. SUPPORT AND MAINTENANCE
Licensor may provide support and maintenance services as mutually agreed upon in a separate Service Level Agreement (SLA). Pro-tier availability commitments, service credits, and measurement methodology are defined in [SLA_SLO.md](SLA_SLO.md) (Annex A). Support and SLA remedies are subject to Section 4.7 (Minimum Operating Requirements). The Software includes automated local persistence; however, Licensee is responsible for the physical security, data backups, and day-to-day upkeep of their local factory installations.

## 6. DISCLAIMER OF WARRANTIES
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. LICENSOR DOES NOT WARRANT THAT THE SOFTWARE WILL BE ERROR-FREE OR UNINTERRUPTED.

## 7. LIMITATION OF LIABILITY
IN NO EVENT SHALL LICENSOR BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## 8. GOVERNING LAW AND JURISDICTION
This Agreement and any dispute or claim arising out of or in connection with it or its subject matter or formation shall be governed by and construed in accordance with the laws of the **Dubai International Financial Centre (DIFC)** and applicable federal laws of the **United Arab Emirates (UAE)**.

Any dispute arising out of or in connection with this Agreement, including any question regarding its existence, validity, or termination, shall be subject to the exclusive jurisdiction of the **Courts of the DIFC** in the Emirate of Dubai.

## 9. TERMINATION
This Agreement is effective until terminated. Licensor may terminate this Agreement immediately if Licensee fails to comply with any term or condition hereof, including failure to pay the Annual Fee or overage charges when due after the Free Service Period, or persistent failure to maintain the Minimum Operating Requirements in Section 4.7 after written notice and a reasonable cure period (not less than seven (7) days). Upon termination, Licensee must cease use of the Software and destroy all copies of the Software in its possession.

## 10. ENTIRE AGREEMENT
This Agreement, together with any executed Order Form or Schedule A (fees, usage tier, and Service Start Date), constitutes the entire agreement between the parties concerning the subject matter hereof and supersedes all prior or contemporaneous oral or written understandings.

---
*By deploying or using AbaYa Track, you acknowledge that you have read this Agreement, understand it, and agree to be bound by its terms and conditions.*
