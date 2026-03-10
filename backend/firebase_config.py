"""Firebase Admin SDK initialization and Firestore client."""

import os
import json
import firebase_admin
from firebase_admin import credentials, firestore

_app = None
_db = None


def init_firebase():
    """Initialize Firebase Admin SDK.

    Looks for credentials in this order:
    1. FIREBASE_SERVICE_ACCOUNT_KEY env var (path to JSON key file)
    2. FIREBASE_SERVICE_ACCOUNT_JSON env var (inline JSON string)
    3. Application Default Credentials (Cloud Run, GCE, etc.)
    """
    global _app, _db

    if _app is not None:
        return

    key_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY")
    key_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT", os.getenv("GCP_PROJECT", "dm-debate-studio"))

    options = {"projectId": project_id}

    if key_path and os.path.exists(key_path):
        cred = credentials.Certificate(key_path)
    elif key_json:
        cred = credentials.Certificate(json.loads(key_json))
    else:
        cred = credentials.ApplicationDefault()

    _app = firebase_admin.initialize_app(cred, options)
    _db = firestore.client()


def get_db():
    """Get Firestore client, initializing Firebase if needed."""
    global _db
    if _db is None:
        init_firebase()
    return _db


def get_app():
    """Get Firebase app, initializing if needed."""
    global _app
    if _app is None:
        init_firebase()
    return _app
