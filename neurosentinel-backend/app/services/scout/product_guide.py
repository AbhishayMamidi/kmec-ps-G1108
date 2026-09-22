from __future__ import annotations

from typing import Any

from app.pipeline.config import PRODUCTION_METRICS, SCOUT_FULL_NAME


PRODUCT_SNIPPETS = {
    "identity": {
        "title": SCOUT_FULL_NAME,
        "body": "SCOUT is NeuroSentinel AI's in-product assistant for onboarding, product help, and report explanation. It never diagnoses, prescribes, or invents unavailable metrics.",
    },
    "workflow": {
        "title": "Core workflow",
        "body": "Users sign in with Supabase auth, land on the dashboard, upload EDF files, track pending or processing reports, then open completed reports for the full structured explanation.",
    },
    "upload": {
        "title": "Upload behavior",
        "body": "The frontend creates a pending report immediately, uploads the EDF into Supabase Storage, then asks the FastAPI backend to analyze the stored file asynchronously.",
    },
    "reports": {
        "title": "Report behavior",
        "body": "The canonical analysis record lives in the reports table. The full report_json stores notebook-derived outputs, while summary fields keep the dashboard and reports list fast to render.",
    },
    "model": {
        "title": "Model facts",
        "body": (
            f"The production model is V4 with {PRODUCTION_METRICS['accuracy_pct']}% accuracy, "
            f"macro F1 {PRODUCTION_METRICS['macro_f1']}, and {PRODUCTION_METRICS['event_fp_per_hour']} false positives per hour "
            f"at {PRODUCTION_METRICS['event_sensitivity_pct']}% event sensitivity."
        ),
    },
    "guardrails": {
        "title": "Clinical guardrails",
        "body": "Every output is labeled as model-learned, derived, or heuristic. Unknown values stay unknown. SCOUT explains results but does not diagnose or recommend treatment changes.",
    },
    "seizure_causes": {
        "title": "Seizure causes and etiology",
        "body": (
            "Common causes of seizures include: genetic predisposition and family history, "
            "structural brain abnormalities (cortical dysplasia, mesial temporal sclerosis, tumors), "
            "head trauma and traumatic brain injury, brain infections (meningitis, encephalitis), "
            "stroke and cerebrovascular disease, metabolic imbalances (hypoglycemia, electrolyte disturbances, "
            "uremia, hepatic encephalopathy), sleep deprivation, high fever (febrile seizures in children), "
            "drug or alcohol withdrawal, certain medications that lower seizure threshold, "
            "autoimmune conditions, and idiopathic/unknown causes. "
            "Temporal lobe epilepsy is the most common focal epilepsy (~60% of cases). "
            "Brain region involvement helps narrow etiology: temporal suggests hippocampal pathology, "
            "frontal suggests cortical dysplasia or trauma, occipital suggests vascular or structural lesions."
        ),
    },
    "health_diet_tips": {
        "title": "Health, diet, and lifestyle for seizure management",
        "body": (
            "Key lifestyle factors: maintain 7-9 hours of consistent sleep (sleep deprivation is the #1 modifiable trigger). "
            "Manage stress through meditation, deep breathing, gentle yoga, or regular walks. "
            "Diet: eat balanced, regular meals — skipping meals lowers blood sugar and raises risk. "
            "Mediterranean-style diet (vegetables, fruits, whole grains, lean protein, omega-3 from fish, olive oil) "
            "supports brain health. Limit caffeine, avoid alcohol (both lower seizure threshold). "
            "Ketogenic diet may help drug-resistant epilepsy — consult neurologist before starting. "
            "Stay well hydrated. Grapefruit interacts with some AEDs — check with pharmacist. "
            "Regular moderate exercise (walking, swimming, cycling) benefits brain health and mood. "
            "Avoid extreme exhaustion and overheating. Keep a seizure diary (episodes, missed meds, sleep, stress). "
            "Medication adherence is critical — never skip or change dose without medical guidance."
        ),
    },
    "safety_guidance": {
        "title": "Seizure safety and emergency guidance",
        "body": (
            "For patients with active seizures: do not drive or operate machinery unless cleared by neurologist. "
            "Avoid swimming alone, use showers over baths, stay away from heights and open flames unsupervised. "
            "Inform household members about seizure first aid: keep the person safe, do not restrain or put objects in mouth, "
            "turn them on their side, time the seizure, call emergency services if it lasts >5 minutes or repeats without recovery. "
            "Consider medical ID bracelet. For high/critical risk: contact neurologist within 24-48 hours. "
            "For moderate risk: schedule follow-up within 1-2 weeks. For low risk: discuss at next routine visit. "
            "Status epilepticus (continuous seizure >5 min) is a medical emergency requiring immediate 911/ambulance."
        ),
    },
    "medication_awareness": {
        "title": "Anti-seizure medication awareness",
        "body": (
            "Common anti-seizure medications (AEDs) include levetiracetam, lamotrigine, carbamazepine, "
            "valproate, oxcarbazepine, topiramate, and lacosamide. SCOUT does not prescribe or recommend "
            "specific medications — this is always the neurologist's decision. Key awareness points: "
            "never stop or change AED dose without medical guidance (risk of breakthrough seizures). "
            "Report side effects (dizziness, fatigue, mood changes) to your doctor. "
            "Some AEDs interact with other medications and foods. Regular blood level monitoring may be needed. "
            "Women of childbearing age should discuss AED choice with their doctor due to teratogenicity risks. "
            "Adherence is the single most important factor in seizure control."
        ),
    },
}


def select_product_snippets(page: str | None, query: str) -> list[dict[str, Any]]:
    normalized = query.lower()
    selected = [PRODUCT_SNIPPETS["identity"], PRODUCT_SNIPPETS["guardrails"]]
    if page == "dashboard" or any(term in normalized for term in ["upload", "dashboard", "start", "tour"]):
        selected.append(PRODUCT_SNIPPETS["workflow"])
        selected.append(PRODUCT_SNIPPETS["upload"])
    if page == "report" or any(term in normalized for term in ["report", "result", "heatmap", "attention", "risk"]):
        selected.append(PRODUCT_SNIPPETS["reports"])
        selected.append(PRODUCT_SNIPPETS["model"])
        # Always include clinical knowledge on report pages
        selected.append(PRODUCT_SNIPPETS["seizure_causes"])
        selected.append(PRODUCT_SNIPPETS["health_diet_tips"])
        selected.append(PRODUCT_SNIPPETS["safety_guidance"])
    if any(term in normalized for term in ["cause", "why", "trigger", "reason", "etiology", "origin"]):
        selected.append(PRODUCT_SNIPPETS["seizure_causes"])
    if any(term in normalized for term in ["diet", "food", "eat", "nutrition", "health", "lifestyle", "sleep", "exercise", "tip"]):
        selected.append(PRODUCT_SNIPPETS["health_diet_tips"])
    if any(term in normalized for term in ["safety", "emergency", "danger", "drive", "swim", "first aid", "what to do"]):
        selected.append(PRODUCT_SNIPPETS["safety_guidance"])
    if any(term in normalized for term in ["medication", "medicine", "drug", "pill", "aed", "treatment", "prescription"]):
        selected.append(PRODUCT_SNIPPETS["medication_awareness"])
    if page == "onboarding":
        selected.append(PRODUCT_SNIPPETS["workflow"])
    deduped = []
    seen = set()
    for snippet in selected:
        if snippet["title"] not in seen:
            deduped.append(snippet)
            seen.add(snippet["title"])
    return deduped
