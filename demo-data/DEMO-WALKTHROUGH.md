# ProviderCard v2 - Detailed Demo Walkthrough

## 🎯 Demo Objective
Show a complete provider data management workflow in 3 minutes, highlighting:
1. Intelligent NUCC autocomplete
2. Dynamic form sections (add/remove)
3. Multi-state licensing
4. Primary location designation
5. Insurance plan management
6. Real-time webhook synchronization

---

## 📋 Pre-Demo Checklist

### Setup (5 minutes before presentation)
- [ ] Browser open to ProviderCard v2 home page
- [ ] Demo provider (Dr. Sarah Johnson) loaded with basic info only
- [ ] Two subscriber systems showing "Connected" status
- [ ] Webhook delivery panel ready (but empty)
- [ ] Test save endpoint to ensure it's responding
- [ ] Close unnecessary browser tabs
- [ ] Set zoom level to 110% for better visibility
- [ ] Turn off notifications/popups

### Required Data Files
- [ ] `demo-data/demo-provider.json` - Seed data
- [ ] `demo-data/webhook-logs.json` - Mock webhook responses
- [ ] `DEMO-SCRIPT.md` - Presentation script

### Backup Materials
- [ ] Screenshots of each step
- [ ] Pre-recorded video (if live demo fails)
- [ ] Printed script as reference

---

## 🎬 Step-by-Step Walkthrough

### **STEP 1: Open Provider Profile (0:00-0:15)**

**What You See:**
```
ProviderCard v2 Home Page
┌─────────────────────────────────────┐
│ ProviderCard v2                     │
│                                     │
│  [Create Provider Profile]          │
│  [System Dashboard]                 │
└─────────────────────────────────────┘
```

**Actions:**
1. Click "Create Provider Profile" (or edit existing)
2. Form opens with tabs visible

**State After:**
- Form showing "General Info" tab
- Dr. Sarah Johnson's basic info visible
- Other tabs empty (Specialties, Licenses, etc.)

**Script:**
> "Let's edit Dr. Johnson's profile. She's already in our system with basic demographics, but we need to complete her credentials."

---

### **STEP 2: Add Specialties with Autocomplete (0:15-0:45)**

**What You See:**
```
Specialties Tab
┌─────────────────────────────────────┐
│ Search Specialties: [cardio_____]  │
│ ┌─ Dropdown ──────────────────────┐│
│ │ ✓ Cardiovascular Disease        ││
│ │   (207RC0000X)                  ││
│ │   Internal Medicine - Cardiology││
│ │   Cardiothoracic Surgery        ││
│ └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**Actions:**
1. Click **Specialties** tab
2. In search box, type: `cardio`
3. Dropdown appears with matching specialties
4. Click: **Cardiovascular Disease (207RC0000X)**
5. Check **"☑ Primary Specialty"** checkbox
6. Code auto-fills in the display
7. Click **"+ Add Another Specialty"**
8. Type: `internal`
9. Click: **Internal Medicine (207R00000X)**
10. Leave "Primary" unchecked

**State After:**
```
Specialties Added:
✅ Cardiovascular Disease (207RC0000X) [Primary]
✅ Internal Medicine (207R00000X)
```

**Script:**
> "Watch how the NUCC autocomplete works. I type 'cardio' and get instant suggestions. Select one, and the code auto-fills. No memorization needed!"

**Presenter Tips:**
- Type slowly so audience sees autocomplete
- Emphasize the code appearing automatically
- Point out "Primary" designation

---

### **STEP 3: Add Medical Licenses (0:45-1:15)**

**What You See:**
```
Licenses Tab (Initially Empty)
┌─────────────────────────────────────┐
│ No licenses added yet               │
│ [+ Add License]                     │
└─────────────────────────────────────┘
```

**Actions:**

**License #1:**
1. Click **Licenses** tab
2. Click **"+ Add License"**
3. Form row appears
4. Fill fields:
   - **State:** Massachusetts (dropdown)
   - **License Number:** `MD123456`
   - **Type:** MD (dropdown)
   - **Status:** Active (dropdown)
   - **Expiration:** `12/31/2026` (datepicker)

**License #2:**
5. Click **"+ Add License"** again
6. Second row appears
7. Fill fields:
   - **State:** New Hampshire
   - **License Number:** `NH789012`
   - **Type:** MD
   - **Status:** Active
   - **Expiration:** `06/30/2026`

**State After:**
```
Licenses Added:
✅ MA - MD123456 (Expires: 12/31/2026) [Remove]
✅ NH - NH789012 (Expires: 06/30/2026) [Remove]
```

**Script:**
> "Many providers practice in multiple states, especially with telemedicine. Here, Dr. Johnson has licenses in Massachusetts and New Hampshire. Notice the expiration dates—our system will alert credentialing teams 90 days before renewal."

**Presenter Tips:**
- Show the "Add License" button clearly
- Demonstrate removing a row (optional)
- Mention expiration tracking feature

---

### **STEP 4: Add Practice Locations (1:15-1:45)**

**What You See:**
```
Practice Locations Tab
┌─────────────────────────────────────┐
│ [+ Add Location]                    │
└─────────────────────────────────────┘
```

**Actions:**

**Location #1 (Primary):**
1. Click **Practice Locations** tab
2. Click **"+ Add Location"**
3. Fill fields:
   - **Name:** `Boston Medical Plaza`
   - **Address Line 1:** `123 Medical Plaza`
   - **Address Line 2:** `Suite 200`
   - **City:** `Boston`
   - **State:** `MA`
   - **ZIP:** `02101`
   - **Phone:** `617-555-0100`
   - **☑ Primary Location** (checked)

**Location #2 (Secondary):**
4. Click **"+ Add Location"** again
5. Fill fields:
   - **Name:** `Cambridge Satellite Office`
   - **Address:** `456 Healthcare Drive`
   - **City:** `Cambridge`
   - **State:** `MA`
   - **ZIP:** `02138`
   - **Phone:** `617-555-0200`
   - **☐ Primary Location** (unchecked)

**State After:**
```
Locations Added:
⭐ Boston Medical Plaza
   123 Medical Plaza, Suite 200
   Boston, MA 02101
   [Primary] [Remove]

📍 Cambridge Satellite Office
   456 Healthcare Drive
   Cambridge, MA 02138
   [Remove]
```

**Script:**
> "Providers often see patients at multiple locations. We designate Boston as the primary practice—this helps with patient routing and referral systems."

**Presenter Tips:**
- Highlight the "Primary" checkbox
- Show that only one can be primary
- Mention patient routing benefit

---

### **STEP 5: Add Insurance Plans (1:45-2:15)**

**What You See:**
```
Insurance Plans Tab
┌─────────────────────────────────────┐
│ [+ Add Insurance Plan]              │
└─────────────────────────────────────┘
```

**Actions:**

**Plan #1:**
1. Click **Insurance Plans** tab
2. Click **"+ Add Insurance Plan"**
3. Fill dropdowns:
   - **Carrier:** Aetna
   - **Plan Name:** Aetna PPO
   - **Line of Business:** Commercial
   - **Network Status:** In-Network
   - **☑ Accepting New Patients**

**Plan #2:**
4. Click **"+ Add Insurance Plan"**
5. Fill:
   - **Carrier:** Medicare
   - **Plan Name:** Traditional Medicare
   - **LOB:** Medicare
   - **Status:** In-Network
   - **☑ Accepting New Patients**

**Plan #3:**
6. Click **"+ Add Insurance Plan"**
7. Fill:
   - **Carrier:** Blue Cross Blue Shield of Massachusetts
   - **Plan Name:** BCBS HMO Blue
   - **LOB:** Commercial
   - **Status:** In-Network
   - **☐ Accepting New Patients** (panel full)

**State After:**
```
Insurance Plans Added:
✅ Aetna - Aetna PPO (Commercial) [In-Network] ✓ Accepting
✅ Medicare - Traditional Medicare (Medicare) [In-Network] ✓ Accepting
✅ BCBS MA - HMO Blue (Commercial) [In-Network] ✗ Panel Full
```

**Script:**
> "Insurance plan acceptance is critical for patient access. Notice we track not just the carrier, but the specific plan, line of business, and whether the provider is accepting new patients."

**Presenter Tips:**
- Emphasize the "Accepting New Patients" flag
- Mention how this prevents scheduling errors
- Show Line of Business options

---

### **STEP 6: Save Profile (2:15-2:30)**

**What You See:**
```
Bottom of Form
┌─────────────────────────────────────┐
│ [Cancel] [Save Provider]            │
└─────────────────────────────────────┘
```

**Actions:**
1. Scroll to bottom of form
2. Click **"Save Provider"** button
3. Button changes to: `[⟳ Saving...]`
4. Brief loading (1-2 seconds)
5. Success message appears:
   ```
   ✅ Provider saved successfully!
   Redirecting to dashboard...
   ```
6. Auto-redirect to dashboard

**State After:**
- Dashboard page loads
- Provider listed with updated timestamp
- Sync status shows "Pending sync"

**Script:**
> "The system validates all required fields before saving. If anything were missing—like forgetting to mark a primary location—we'd see a clear 'Failed to save' error with specific issues highlighted. But everything looks good, so we save successfully!"

**Presenter Tips:**
- If doing error demo: Uncheck "Primary" first, show error, fix, then save
- Emphasize validation before save
- Show the success message clearly

---

### **STEP 7: Dashboard & Sync Status (2:30-2:50)**

**What You See:**
```
System Dashboard
┌─────────────────────────────────────────────┐
│ Connected Systems              [Sync Now]   │
├─────────────────────────────────────────────┤
│ ✅ Credentialing Management System          │
│    Last sync: 2 minutes ago                 │
│                                             │
│ ✅ Provider Directory Service               │
│    Last sync: 2 minutes ago                 │
└─────────────────────────────────────────────┘
```

**Actions:**
1. Dashboard loads automatically
2. Show connected systems:
   - **✅ Credentialing System** - Green checkmark
   - **✅ Provider Directory** - Green checkmark
3. Point out "Last sync" timestamps
4. Click **"Sync Now"** button
5. Button changes: `[⟳ Syncing...]`
6. Status updates: `Syncing in progress...`
7. After 2 seconds:
   - Button returns to `[Sync Now]`
   - Timestamps update: `Last sync: Just now`
   - New section appears: **Recent Webhook Deliveries**

**State After:**
```
┌─────────────────────────────────────────────┐
│ Recent Webhook Deliveries                   │
├─────────────────────────────────────────────┤
│ ✅ Credentialing System                     │
│    practitioner.updated | 200 OK | 2s ago   │
│                                             │
│ ✅ Provider Directory                       │
│    practitioner.updated | 200 OK | 2s ago   │
└─────────────────────────────────────────────┘
```

**Script:**
> "Now we're on the dashboard showing our connected systems. Both have green checkmarks indicating healthy connections. Let's manually trigger a sync to push our updates immediately."

**Presenter Tips:**
- Point to green checkmarks
- Explain manual sync vs. scheduled batch
- Emphasize real-time capability

---

### **STEP 8: Webhook Confirmation (2:50-3:00)**

**What You See:**
```
Webhook Delivery Details
┌─────────────────────────────────────────────┐
│ ✅ Credentialing Management System          │
│    Event: practitioner.updated              │
│    Status: 200 OK                           │
│    Response Time: 245ms                     │
│    Time: 2 seconds ago                      │
│                                             │
│    [View Payload ▼]                         │
└─────────────────────────────────────────────┘
```

**Actions:**
1. Scroll to **"Recent Webhook Deliveries"**
2. Show two successful deliveries (green checkmarks)
3. Click **"View Payload ▼"** on first webhook
4. Expanded view shows JSON payload:
   ```json
   {
     "eventType": "practitioner.updated",
     "timestamp": "2025-10-24T16:30:45Z",
     "resource": {
       "resourceType": "Practitioner",
       "id": "demo-001",
       "name": "Dr. Sarah Johnson",
       "specialties": ["207RC0000X", "207R00000X"],
       "licenses": [
         {"state": "MA", "number": "MD123456"},
         {"state": "NH", "number": "NH789012"}
       ]
     }
   }
   ```
5. Point out response confirmation:
   ```
   Response: {
     "status": 200,
     "message": "Provider update processed successfully"
   }
   ```

**State After:**
- Both webhooks showing ✅ delivered
- Timestamps: "2 seconds ago"
- Response codes: 200 OK

**Script:**
> "Here's the real magic—both systems received the update instantly via FHIR-compliant webhooks. The credentialing system confirmed receipt and triggered a credentialing review. The directory service updated its search index. No manual data entry, no sync delays—just instant, reliable updates."

**Presenter Tips:**
- Emphasize "instant" and "200 OK"
- Show the FHIR-compliant payload
- Highlight the "processed successfully" response

---

## 🎯 Demo Metrics Summary

Show at end of demo:

```
Demo Completion Summary
┌─────────────────────────────────────┐
│ Time to Complete: 2 min 45 sec      │
│ Systems Synced: 2/2 (100%)          │
│ Webhook Success: 2/2 (100%)         │
│ Data Quality: All fields validated  │
│ Sync Speed: < 3 seconds e2e         │
└─────────────────────────────────────┘
```

---

## 🎬 Presenter Tips

### Before Demo:
- **Practice 3 times** minimum
- **Time yourself** - aim for 2:45-2:55
- **Have backup** screenshots ready
- **Test all clicks** beforehand

### During Demo:
- **Slow down** typing for autocomplete
- **Pause briefly** after each save/sync
- **Point to screen** when highlighting features
- **Make eye contact** between actions

### After Demo:
- **Show metrics** slide
- **Ask for questions**
- **Have code ready** to share

---

## 🚨 Troubleshooting

### If Save Fails:
1. Say: "Perfect! This is actually our error handling demo."
2. Show red error message
3. Highlight validation details
4. Fix error and save successfully

### If Webhook Doesn't Appear:
1. Say: "Webhooks are queued and processing..."
2. Refresh dashboard
3. Show pre-loaded webhook logs as backup

### If System Freezes:
1. Switch to backup screenshots
2. Walk through each step with visuals
3. Show pre-recorded video if available

---

## 📊 Q&A Preparation

**Expected Questions:**

1. **"How does NUCC autocomplete work?"**
   > "We maintain a local index of all 900+ NUCC codes with fuzzy search. Real-time filtering as you type."

2. **"Can you sync to more than 2 systems?"**
   > "Yes, unlimited subscribers. We've tested with 50+ concurrent webhooks."

3. **"What if a webhook fails?"**
   > "Exponential backoff retry with configurable attempts. Failed deliveries are logged and alerted."

4. **"Is this FHIR R4 compliant?"**
   > "Yes, 100% FHIR R4 Practitioner, PractitionerRole, and Subscription resources."

5. **"Can providers self-edit?"**
   > "Yes, with role-based access. Providers edit basic info; credentialing teams approve licenses."

---

**Ready to present!** 🎉
