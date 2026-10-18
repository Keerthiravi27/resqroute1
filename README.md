# 🚑 ResQRoute

**A Real Time SOS Based Hospital Coordination System for Emergency Patient Transport**

ResQRoute helps ambulance teams find a suitable hospital before they arrive. The driver or paramedic triggers an SOS, shares a short voice note about the patient's condition along with the live ambulance location, and nearby hospitals respond on whether the needed specialists, equipment and facilities are ready.

> ⚠️ ResQRoute is a coordination aid only. It does not diagnose patients, does not replace emergency dispatchers, and does not guarantee hospital capacity. Availability must always be confirmed by authorised hospital staff.

---

## 📌 Problem Statement

During emergencies like heart attacks, accidents or labour pain, ambulances often go to the nearest hospital without knowing if the required specialist, equipment or facility is available there. If the hospital cannot give the needed care, the patient has to be moved again, which causes avoidable delay.

The core gap is the lack of a simple, real time way to share emergency information and ambulance location with nearby hospitals, and let authorised staff confirm readiness before arrival.

### Challenges in the current process

* **Uncertain hospital readiness:** Teams may not know if the nearest hospital has the right specialist or equipment.
* **Avoidable transfer delays:** A wrong first destination means a second transport.
* **Fragmented communication:** Patient details, location and availability are shared through separate calls and manual steps.
* **Changing information:** Specialist availability and capacity change quickly, so old status leads to poor decisions.
* **Connectivity limits:** Weak network or GPS issues can break alerts, so a phone or radio fallback is needed.
* **Privacy and reliability:** Patient details should reach only authorised people, and unverified availability must never be shown as confirmed.

---

## 💡 Our Solution

1. **Trigger SOS:** The driver or paramedic presses the SOS button.
2. **Share essential details:** The app sends the ambulance location plus a short voice note or structured emergency summary.
3. **Find nearby hospitals:** Hospitals within a configurable radius are listed using location data.
4. **Confirm readiness:** Authorised hospital staff review the alert and reply about their facilities and specialists.
5. **Coordinate destination:** The ambulance team reviews the responses and confirms the destination with the hospital or dispatcher.
6. **Track status:** The system records whether the alert was created, sent, received and answered.

---

## ✨ Features

* SOS form that captures location and a voice note or text summary
* Map and list view of nearby hospitals using sample coordinates
* Hospital dashboard to accept, decline or request clarification
* Status timeline for alert creation, delivery and hospital response
* "Last updated" time shown for every hospital status
* Demo dataset built from synthetic or properly licensed data

---

## 👥 Target Audience

* **Primary users:** Ambulance drivers, paramedics and emergency medical technicians
* **Hospital users:** Emergency department coordinators, duty doctors, triage staff and hospital operations teams
* **Supporting stakeholders:** Dispatch centres, ambulance service operators, hospital administrators and emergency response networks
* **Beneficiaries:** Patients and caregivers who gain from fewer avoidable transfers

---

## 🛠️ Tech Stack (Planned)

The stack below is the proposed open source Linux based setup for the prototype.

| Layer | Technology |
| --- | --- |
| OS and hosting | Ubuntu Linux |
| Backend API | Python with Flask or FastAPI |
| Database | SQLite or PostgreSQL |
| Maps | OpenStreetMap data with Leaflet |
| Voice notes | Browser MediaRecorder API |
| Notifications | In app dashboard updates, optional email through an SMTP server |

Note: Linux alone does not provide SMS or push notifications, so the demo uses dashboard updates and optional email.

---

## 📊 Datasets

This is a datathon prototype, so it uses only public, openly licensed or synthetic data. No real patient records are used.

| Dataset | Use |
| --- | --- |
| Hospital directory | Hospital ID, name, address, coordinates, contact channel and service categories (open directory or clearly labelled mock data) |
| Hospital capability and readiness | Specialties, emergency services, equipment and status with last updated time (simulated and labelled for the demo) |
| Geospatial data | Ambulance and hospital coordinates for distance and nearby facility search |
| Emergency request records | Synthetic incident ID, timestamp, broad emergency category, approximate location, alert status and response times (no names, phone numbers or identifiable medical records) |
| Voice note samples (optional) | Scripted, consented, non identifying recordings or transcripts for testing uploads |
| Traffic and route data (optional) | Openly licensed or simulated travel time data, clearly labelled |

Please check each dataset's licence and permitted use before including it.

---

## ⚙️ Installation and Setup

> Update the commands below to match your actual project files.

```bash
# 1. Clone the repository
git clone https://github.com/Keerthiravi27/resqroute1.git
cd resqroute1

# 2. Create a virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the backend
python app.py
```

Then open `http://localhost:5000` in your browser (change the port if your app uses a different one).

---

## 🚀 Usage

1. Open the SOS page and allow location and microphone access.
2. Record a short voice note or type an emergency summary.
3. Press **SOS** to send the alert to nearby hospitals.
4. Hospital staff open the dashboard and accept, decline or ask for clarification.
5. The ambulance team checks the responses and confirms the destination with the hospital or dispatcher.

---

## 🧪 Scenarios Tested

* Nearest hospital is unavailable
* Multiple hospitals respond
* No hospital responds

---

## 🔒 Data Privacy, Safety and Limitations

* Only synthetic or anonymised data is used. No real patient identifiers or sensitive health records.
* Dashboard access is restricted and only the minimum information needed for coordination is shared.
* HTTPS and authentication are required if deployed beyond a local demo.
* Hospital status always shows its last updated time. Stale or simulated availability is never treated as confirmed.
* Phone or radio coordination stays as a fallback if the internet, GPS or app fails.
* The prototype is not a diagnosis tool and does not decide clinical priority on its own.

---

## 📝 Summary

ResQRoute aims to reduce avoidable delays caused by uncertainty about hospital readiness. By sharing the SOS request, patient needs and ambulance location with nearby hospitals, ambulance teams can coordinate with authorised staff before arrival. The Linux based, open source prototype shows this workflow using synthetic datasets and clearly labelled simulated availability.
