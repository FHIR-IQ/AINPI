# ProviderCard v2 - 3-Minute Demo Script

> **Objective:** Demonstrate the complete provider management workflow from profile editing to real-time system synchronization

---

## 🎬 Demo Setup (Before Presentation)

### Pre-loaded State
- **Provider:** Dr. Sarah Johnson (partially complete profile)
- **Connected Systems:** 2 subscriber systems ready to receive updates
- **Browser:** Open to ProviderCard v2 home page

---

## 📝 Demo Script (3 Minutes)

### **[0:00-0:15] Introduction (15 seconds)**

**Script:**
> "Welcome to ProviderCard v2 - a modern provider directory and credentialing system. Today, I'll show you how we've simplified provider data management with FHIR standards, intelligent autocomplete, and real-time synchronization."

**Actions:**
- Show home page
- Click "Create Provider Profile" or edit existing Dr. Sarah Johnson

---

### **[0:15-0:45] Specialty Selection with NUCC Autocomplete (30 seconds)**

**Script:**
> "Let's start with specialties. Instead of memorizing complex NUCC taxonomy codes, providers simply type what they do. Watch this..."

**Actions:**
1. Click **Specialties** tab
2. Type "cardio" in specialty search box
3. **Demo Point:** Autocomplete dropdown appears instantly
4. Select "**Cardiovascular Disease (207RC0000X)**"
5. **Demo Point:** Code auto-fills automatically
6. Mark it as "Primary Specialty"
7. Add second specialty: Type "internal" → Select "**Internal Medicine (207R00000X)**"

**Key Callout:**
> "Notice how the system automatically maps friendly names to official NUCC codes - no training required!"

---

### **[0:45-1:15] Add Multiple Licenses (30 seconds)**

**Script:**
> "Now let's add medical licenses. Providers often practice in multiple states, so our system makes it easy to manage them all."

**Actions:**
1. Click **Licenses** tab
2. Click **"+ Add License"** button
3. Fill in License #1:
   - **State:** Massachusetts (dropdown)
   - **License Number:** MD123456
   - **Type:** MD
   - **Status:** Active
   - **Expiration:** 12/31/2026
4. Click **"+ Add License"** again
5. Fill in License #2:
   - **State:** New Hampshire
   - **License Number:** NH789012
   - **Type:** MD
   - **Status:** Active
   - **Expiration:** 06/30/2026

**Key Callout:**
> "The system validates expiration dates and will alert credentialing teams 90 days before renewal."

---

### **[1:15-1:45] Add Practice Locations (30 seconds)**

**Script:**
> "Many providers work at multiple locations. Let's add two practice addresses and designate the primary one."

**Actions:**
1. Click **Practice Locations** tab
2. Click **"+ Add Location"**
3. Fill in Location #1:
   - **Name:** Boston Medical Plaza
   - **Address:** 123 Medical Plaza, Suite 200
   - **City:** Boston
   - **State:** MA
   - **ZIP:** 02101
   - **☑ Primary Location** (checkbox)
4. Click **"+ Add Location"** again
5. Fill in Location #2:
   - **Name:** Cambridge Satellite Office
   - **Address:** 456 Healthcare Drive
   - **City:** Cambridge
   - **State:** MA
   - **ZIP:** 02138
   - **☐ Primary Location** (unchecked)

**Key Callout:**
> "The primary flag ensures patients and referral systems know the main practice location."

---

### **[1:45-2:15] Add Insurance Plans (30 seconds)**

**Script:**
> "Finally, let's specify which insurance plans this provider accepts. This is critical for patient access."

**Actions:**
1. Click **Insurance Plans** tab
2. Click **"+ Add Plan"**
3. Add Plan #1:
   - **Carrier:** Aetna (dropdown)
   - **Plan Name:** Aetna PPO
   - **Line of Business:** Commercial (dropdown)
   - **Status:** In-Network
   - **Accepting New Patients:** ✅ Yes
4. Click **"+ Add Plan"**
5. Add Plan #2:
   - **Carrier:** Medicare
   - **Plan Name:** Traditional Medicare
   - **Line of Business:** Medicare
   - **Status:** In-Network
   - **Accepting New Patients:** ✅ Yes
6. Add Plan #3:
   - **Carrier:** Blue Cross Blue Shield of Massachusetts
   - **Plan Name:** BCBS HMO Blue
   - **Line of Business:** Commercial
   - **Status:** In-Network
   - **Accepting New Patients:** ❌ No (panel full)

**Key Callout:**
> "We track network status and panel availability - crucial for patient scheduling."

---

### **[2:15-2:30] Save with Validation (15 seconds)**

**Script:**
> "Now let's save. The system validates all required fields before submission."

**Actions:**
1. Scroll to bottom
2. Click **"Save Provider"** button
3. **Demo Point:** Brief loading indicator
4. **✅ Success message appears:** "Provider saved successfully!"
5. Automatically redirects to dashboard

**Key Callout:**
> "If there were errors - missing required fields or invalid data - we'd see a clear 'Failed to save' message with specific issues highlighted."

---

### **[2:30-2:50] Dashboard & Sync Status (20 seconds)**

**Script:**
> "Now we're on the dashboard. This shows all connected external systems and their sync status."

**Actions:**
1. Show dashboard with connected systems:
   - **✅ Credentialing Management System** - Last sync: 2 minutes ago
   - **✅ Provider Directory Service** - Last sync: 2 minutes ago
2. **Demo Point:** Green checkmarks indicate healthy connections
3. Click **"Sync Now"** button
4. **Demo Point:** Button shows "Syncing..." with spinner
5. Status updates to "Syncing in progress..."

**Key Callout:**
> "Manual sync pushes updates immediately instead of waiting for the scheduled batch. Perfect for urgent credential updates."

---

### **[2:50-3:00] Webhook Confirmation (10 seconds)**

**Script:**
> "And here's the real magic - our connected systems receive the updates in real-time via FHIR-compliant webhooks."

**Actions:**
1. Switch to **"Recent Webhook Deliveries"** panel (on dashboard)
2. Show webhook log entries:
   ```
   ✅ Credentialing System
      Event: practitioner.updated
      Status: 200 OK
      Time: 2 seconds ago

   ✅ Provider Directory
      Event: practitioner.updated
      Status: 200 OK
      Time: 2 seconds ago
   ```
3. Click one webhook entry to expand:
   ```json
   {
     "eventType": "practitioner.updated",
     "timestamp": "2025-10-24T16:30:45Z",
     "resource": {
       "resourceType": "Practitioner",
       "id": "prac-001",
       "name": "Dr. Sarah Johnson",
       "specialties": ["207RC0000X", "207R00000X"],
       "licenses": [
         {"state": "MA", "number": "MD123456"},
         {"state": "NH", "number": "NH789012"}
       ]
     }
   }
   ```

**Key Callout:**
> "Both systems confirmed receipt. No more manual data entry, no more sync delays - just instant, reliable updates across the entire ecosystem."

---

## 🎯 Demo Conclusion (Wrap-up)

**Script:**
> "In just 3 minutes, we've shown how ProviderCard v2 transforms provider data management:
> - Intelligent autocomplete for specialties
> - Easy multi-state license tracking
> - Multiple practice locations
> - Comprehensive insurance plan management
> - Real-time synchronization to credentialing and directory systems
>
> All built on FHIR R4 standards, ensuring interoperability and future-proofing your provider data."

---

## 📊 Demo Metrics Highlight

At end of demo, show quick stats:
- **⚡ Time to Add Provider:** < 2 minutes
- **📡 Systems Synced:** 2/2 (100%)
- **✅ Data Quality:** All required fields validated
- **🔄 Sync Speed:** < 3 seconds end-to-end

---

## 🎬 Technical Notes for Presenter

### Before Demo:
- Pre-load Dr. Sarah Johnson with basic info (name, NPI, email)
- Leave specialties, licenses, locations, and insurance blank
- Ensure 2 mock subscriber systems are "connected" in dashboard
- Have webhook delivery panel ready to display

### Backup Plan:
If live demo fails:
- Have screenshots of each step
- Pre-recorded video walkthrough as backup
- Static JSON showing webhook payload

### Key Talking Points:
1. **NUCC Autocomplete** - Eliminates training burden
2. **Multi-State Licensing** - Critical for telemedicine
3. **Primary Location Flag** - Improves patient routing
4. **Insurance Panel Status** - Prevents scheduling errors
5. **Real-time Sync** - No more data silos

---

## 🎥 Optional Extensions (If Time Permits)

### 4-Minute Version: Add Error Handling Demo
- Intentionally leave "Primary Specialty" blank
- Click Save
- Show **"Failed to save"** error message with validation details
- Fix error and save successfully

### 5-Minute Version: Add License Expiration Alert
- Show license expiring in 60 days
- Dashboard displays yellow warning badge
- Demo automated notification to credentialing team

---

## 📁 Demo Assets Included

1. **Seed Data:** `demo-data/demo-provider.json`
2. **Mock Webhooks:** `demo-data/webhook-logs.json`
3. **Screenshots:** `demo-data/screenshots/` (backup)
4. **Video:** `demo-data/demo-walkthrough.mp4` (backup)

---

**Ready to present!** 🚀
