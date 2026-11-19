import hmac
import json
import os
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

# Isolate fixtures before loading the application. CI optionally exercises PostGIS.
storage = TemporaryDirectory()
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", f"sqlite:///{storage.name}/test.sqlite")
os.environ["APP_ENV"] = "local"
os.environ["DATA_KEY"] = Fernet.generate_key().decode()
os.environ["BOOTSTRAP_EMAIL"] = "admin@example.invalid"
os.environ["BOOTSTRAP_PASSWORD"] = "Synthetic-bootstrap-42"
os.environ.pop("NIPOST_API_KEY", None)
from backend.core import engine, one, reveal, transaction
from backend.main import app
from backend.postcodes import normalize

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test:
        yield test
    engine.dispose()
    storage.cleanup()

def login(client, email="admin@example.invalid", password="Synthetic-bootstrap-42"):
    result = client.post("/v1/login", json={"email":email,"password":password})
    assert result.status_code == 200, result.text
    return {"Authorization":"Bearer "+result.json()["token"]}

@pytest.fixture(scope="module")
def admin(client):
    return login(client)

def new_org(client, admin, name):
    res = client.post("/v1/admin/organisations", json={"name":name,"verified":True}, headers=admin)
    assert res.status_code == 201
    return res.json()["id"]

def new_user(client, admin, org, key, role):
    email, password = key+"@example.invalid","Synthetic-partner-42"
    res=client.post("/v1/admin/users", json={"email":email,"password":password,"role":role,"org_id":org}, headers=admin)
    assert res.status_code == 201, res.text
    return res.json()["id"],login(client,email,password)

def save_facility(client,admin,key,**overrides):
    payload = {"name":"TEST FIXTURE ONLY","lga":"Test Area","state":"Kaduna","category":"phc",
               "lat":10.52,"lon":7.44,"source":"https://example.invalid/test-evidence",**overrides}
    res=client.post("/v1/admin/facilities/"+key, json=payload, headers=admin)
    assert res.status_code==200,res.text
    return res.json()

def test_postcode_normalisation():
    assert normalize("ek 01 a03 fk 01") == "EK-01-A03-FK-01"
    for code in ("123456", "EK-00-A03-FK-01", "EK-01-A03-FK-00"):
        with pytest.raises(ValueError):
            normalize(code)

def test_mock_and_official_adapter(client,admin,monkeypatch):
    path="/v1/postcodes/lookup"
    result=client.post(path,headers=admin,json={"postcode":"zz01a01zz01"}).json()
    assert result["source"]=="local_mock" and result["location"]["lat"]==10.52
    assert client.post(path,headers=admin,json={"postcode":"wrong"}).status_code==422
    monkeypatch.setenv("NIPOST_API_KEY","nipost_test_mock_fixture")
    provider=httpx.AsyncClient
    def transport(request):
        assert request.url.host=="api.postcode.gov.ng"
        assert request.url.path=="/v1/lookup"
        assert request.url.params["level"]=="1"
        assert request.headers["X-API-Key"]=="nipost_test_mock_fixture"
        return httpx.Response(200,json={"data":{"valid":True}})
    monkeypatch.setattr("backend.postcodes.httpx.AsyncClient",lambda **kw: provider(transport=httpx.MockTransport(transport),**kw))
    result=client.post(path,headers=admin,json={"postcode":"FC-01-A01-KP-27"})
    assert result.json()=={"valid":True,"source":"nipost_test","location":None,"postcode":"FC-01-A01-KP-27"}
    monkeypatch.setattr("backend.postcodes.httpx.AsyncClient",lambda **kw: provider(transport=httpx.MockTransport(lambda _:httpx.Response(429)),**kw))
    assert client.post(path,headers=admin,json={"postcode":"FC-01-A01-KP-27"}).status_code==503

def test_facilities(client,admin):
    assert not save_facility(client,admin,"test-phc")["published"]
    assert client.get("/v1/facilities/test-phc",headers=admin).status_code==404
    assert save_facility(client,admin,"test-phc",verified_at="2024-01-01")["published"]
    result=client.get("/v1/facilities",headers=admin,params={"lat":10.52,"lon":7.44,"category":"phc","q":"TEST"})
    assert result.status_code==200,result.text
    assert result.json()[0]["distance_km"]==pytest.approx(0,abs=.001)
    assert client.get("/v1/facilities?lat=10.52",headers=admin).status_code==422
    assert client.post("/v1/facilities/test-phc/route",headers=admin,json={"lat":10.52,"lon":7.44}).status_code==503

def test_emergency_cycle_and_access(client,admin):
    org=new_org(client,admin,"Synthetic dispatch team")
    responder_id,responder=new_user(client,admin,org,"responder","responder")
    _,dispatcher=new_user(client,admin,org,"dispatcher","dispatcher")
    body={"category":"maternal","landmark":"synthetic landmark","synthetic":False}
    assert client.post("/v1/incidents",headers=admin,json=body).status_code==422
    body["synthetic"]=True
    res=client.post("/v1/incidents",headers=admin,json=body)
    assert res.status_code==201,res.text
    data=res.json()
    assert data["dispatch_enabled"] is False
    record=data["id"]
    ops="/v1/ops/incidents/"+record
    track="/v1/incidents/"+record+"/track"
    assert client.post(track,headers={**admin,"X-Tracking-Key":"wrong"}).status_code==404
    assert client.post(track,headers={**admin,"X-Tracking-Key":data["tracking_key"]}).json()["status"]=="submitted"
    assert client.patch(ops,json={"status":"assigned"},headers=dispatcher).status_code==409
    assert client.patch(ops,json={"status":"awaiting_acknowledgement"},headers=responder).status_code==404
    assert client.get("/v1/ops/incidents").status_code==401
    assert client.post("/v1/ops/ambulances/demo",headers=dispatcher,json={"label":"Synthetic unit","responder_id":responder_id}).status_code==200
    for status in ("awaiting_acknowledgement","acknowledged","assigned"):
        response=client.patch(ops,json={"status":status,"ambulance_id":"demo"},headers=dispatcher)
        assert response.status_code==200,response.text
        assert response.json()["dispatch_enabled"] is False
    assert client.post(ops+"/messages",json={"message":"Synthetic update"},headers=responder).status_code==201
    assert client.get(ops+"/messages",headers=dispatcher).json()[0]["message"]=="Synthetic update"
    for status in ("en_route","arrived","completed"):
        assert client.patch(ops,json={"status":status},headers=responder).status_code==200
    assert client.get("/v1/ops/ambulances",headers=dispatcher).json()[0]["available"]==1
    with transaction() as db:
        row=one(db,"SELECT location,secret_hash FROM incidents WHERE id=:id",id=record)
    assert "synthetic landmark" not in row["location"] and row["secret_hash"]!=data["tracking_key"]

def test_referrals_are_scoped(client,admin):
    sender=new_org(client,admin,"Synthetic sender")
    receiver=new_org(client,admin,"Synthetic receiver")
    _,from_auth=new_user(client,admin,sender,"sender","clinician")
    _,to_auth=new_user(client,admin,receiver,"receiver","clinician")
    _,other=new_user(client,admin,sender,"analyst","analyst")
    save_facility(client,admin,"test-receiver",verified_at="2024-01-01",org_id=receiver)
    body={"facility_id":"test-receiver","patient_reference":"SYNTHETIC-01","reason":"Training exercise","basis":"consent","synthetic":True}
    assert client.post("/v1/referrals",json=body,headers=other).status_code==403
    response=client.post("/v1/referrals",json=body,headers=from_auth)
    assert response.status_code==201,response.text
    path="/v1/referrals/"+response.json()["id"]
    assert client.patch(path,json={"status":"acknowledged"},headers=from_auth).status_code==409
    for status in ("acknowledged","handed_over","completed"):
        assert client.patch(path,json={"status":status},headers=to_auth).status_code==200
    assert client.get("/v1/referrals",headers=admin).json()[0]["details"] is None
    assert client.get("/v1/analytics",headers=other).json()["cells"]==[]
    assert "SYNTHETIC" not in client.get("/v1/analytics/export",headers=other).text

def test_revocation_and_rate_limit(client, monkeypatch):
    from backend.core import now
    from backend import security
    timestamp = now() + 301
    monkeypatch.setattr(security, "now", lambda: timestamp)
    token=login(client)
    assert client.post("/v1/logout",headers=token).status_code==204
    assert client.get("/v1/me",headers=token).status_code==401
    outcomes=[client.post("/v1/login",json={"email":"wrong@example.invalid","password":"incorrect"}).status_code for _ in range(9)]
    assert 401 in outcomes and outcomes[-1]==429
    assert client.get("/health").json()["dispatch_enabled"] is False

def test_tracking_preflight(client):
    response=client.options("/v1/incidents/test/track",headers={"Origin":"http://localhost:3000",
                           "Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"X-Tracking-Key"})
    assert response.status_code==200


def test_phc_accessibility(client,admin):
    save_facility(client,admin,"centroid-phc",verified_at="2024-01-01")
    payload={"name":"SYNTHETIC COMMUNITY","state":"Kaduna","lga":"Test Area","lat":10.52,"lon":7.55,
             "source":"https://example.invalid/centroid","verified_at":"2024-01-01"}
    assert client.post("/v1/admin/communities/test-centroid",json=payload,headers=admin).status_code==200
    res=client.get("/v1/analytics/access?threshold_km=5",headers=admin)
    assert res.status_code==200,res.text
    place=res.json()["communities"][0]
    assert place["distance_km"]==pytest.approx(12,abs=.2)
    assert place["beyond_threshold"] is True

def test_osrm_route(client,admin,monkeypatch):
    save_facility(client,admin,"osrm-fixture",verified_at="2024-01-01")
    monkeypatch.setenv("OSRM_BASE_URL","https://osrm.example.invalid")
    provider=httpx.AsyncClient
    def transport(request):
        assert request.url.path.startswith("/route/v1/driving/")
        return httpx.Response(200,json={"routes":[{"distance":2400,"duration":420}]})
    monkeypatch.setattr("backend.directory.httpx.AsyncClient",lambda **kw:provider(transport=httpx.MockTransport(transport),**kw))
    res=client.post("/v1/facilities/osrm-fixture/route",headers=admin,json={"lat":10.5,"lon":7.46})
    assert res.json()=={"minutes":7,"km":2.4}


def test_submission_retries_reuse_the_reference(client,admin):
    import uuid
    key=str(uuid.uuid4())
    headers={**admin,"X-Tracking-Key": key}
    location={"category":"other","landmark":"Synthetic interrupted response","synthetic":True}
    first=client.post("/v1/incidents",json=location,headers=headers)
    assert first.status_code==201,first.text
    retry=client.post("/v1/incidents",json=location,headers=headers)
    assert retry.json()==first.json()
    changed=client.post("/v1/incidents",json={**location,"landmark":"Different location"},headers=headers)
    assert changed.status_code==409

def test_lga_density_and_csv(client,admin):
    save_facility(client,admin,"density-test-phc",lga="Density LGA",verified_at="2024-01-01")
    profile={"state":"Kaduna","lga":"Density LGA","population":10000,"area_km2":250,
             "source":"https://example.invalid/area","verified_at":"2024-01-01"}
    assert client.post("/v1/admin/areas/density-test",json=profile,headers=admin).status_code==200
    res=client.get("/v1/analytics/coverage",headers=admin)
    assert res.status_code==200,res.text
    area=res.json()["areas"][0]
    assert area["phcs_per_10000_people"]==1
    assert area["facilities_per_100_km2"]==.4
    assert res.json()["timings"]==[]
    csv=client.get("/v1/analytics/coverage/export",headers=admin)
    assert "density lga" in csv.text and csv.headers["content-type"].startswith("text/csv")

def test_sheet_snapshot_resolves_postcode_and_orders_nearby(client,admin):
    csv = (
        'id,name,state,lga,category,postcode,lat,lon,source,verified_at\n'
        'sheet-far,Sheet import South,Kaduna,Test Area,phc,ZZ-01-A01-ZZ-09,10.59,7.44,https://example.invalid/source,2024-01-01\n'
        'sheet-near,Sheet import Central,Kaduna,Test Area,phc,ZZ-01-A01-ZZ-08,10.52,7.44,https://example.invalid/source,2024-01-01'
    )
    path='/v1/admin/facility-snapshot'
    assert client.post(path,json={'csv':csv}).status_code==401
    assert client.post(path,json={'csv':csv},headers=admin).json()=={'imported':2}
    resolved=client.post('/v1/postcodes/lookup',headers=admin,json={'postcode':'zz01a01zz08'}).json()
    assert resolved['location']=={'lat':10.52,'lon':7.44}
    assert resolved['source']=='facility_directory'
    matched=client.get('/v1/facilities',headers=admin,params={'state':'','q':'Sheet import','lat':10.52,'lon':7.44})
    assert [row['id'] for row in matched.json()]==['sheet-near','sheet-far']


def test_private_sheet_refresh_feeds_nearby_directory(client, admin, monkeypatch):
    path = "/v1/admin/facility-sheet/refresh"
    headers = ["id", "name", "state", "lga", "category", "postcode", "lat", "lon", "source", "verified_at"]
    source = "https://example.invalid/sheet-evidence"
    near = ["refresh-near", "Refresh test near", "FCT", "Test area", "phc", "ZZ-01-A01-ZZ-11", 9.04, 7.46, source, 45292]
    far = ["refresh-far", "Refresh test far", "FCT", "Test area", "phc", "", 9.08, 7.46, source, "2024-01-01"]
    directory_only = ["refresh-directory", "Refresh test directory only", "FCT", "Test area", "phc", "", "", "", source, "2024-01-01"]
    values = [headers, near, [], far, directory_only]
    credentials = MagicMock()
    google_session = MagicMock()
    google_response = google_session.__enter__.return_value.get.return_value
    google_response.json.side_effect = lambda: {"values": values}

    monkeypatch.setenv("GOOGLE_SHEETS_SPREADSHEET_ID", "private-fixture")
    load_credentials = MagicMock(return_value=(credentials, None))
    monkeypatch.setattr("backend.sheet_import.google_credentials", load_credentials)
    monkeypatch.setattr("backend.sheet_import.AuthorizedSession", MagicMock(return_value=google_session))
    save_facility(client, admin, "manual-refresh-check", verified_at="2024-01-01")
    assert client.post(path).status_code == 401
    assert client.post(path, headers=admin).json() == {"imported": 3, "unpublished": 0}
    load_credentials.assert_called_once_with(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    google_session.__enter__.return_value.get.assert_called_once_with(
        "https://sheets.googleapis.com/v4/spreadsheets/private-fixture/values/Facilities",
        params={"valueRenderOption": "UNFORMATTED_VALUE"}, timeout=5,
    )
    resolved = client.post("/v1/postcodes/lookup", headers=admin, json={"postcode": "zz01a01zz11"}).json()
    assert resolved["source"] == "facility_directory"
    facilities = client.get("/v1/facilities",headers=admin, params={"state": "FCT", "q": "Refresh test", **resolved["location"]}).json()
    assert [record["id"] for record in facilities] == ["refresh-near", "refresh-far"]
    assert facilities[0]["verified_at"] == "2024-01-01"
    assert client.get("/v1/facilities/refresh-directory",headers=admin).status_code == 200

    values = [headers, far, far]
    assert client.post(path, headers=admin).status_code == 422
    assert client.get("/v1/facilities/refresh-near",headers=admin).status_code == 200
    values = [headers, far]
    assert client.post(path, headers=admin).json() == {"imported": 1, "unpublished": 2}
    assert client.get("/v1/facilities/refresh-near",headers=admin).status_code == 404
    assert client.get("/v1/facilities/manual-refresh-check",headers=admin).status_code == 200
    values = [headers]
    assert client.post(path, headers=admin).json() == {"imported": 0, "unpublished": 1}
    assert client.get("/v1/facilities/refresh-far",headers=admin).status_code == 404


def test_partner_application_approval_and_one_time_activation(client,admin):
    email='signup-fixture@example.invalid'
    assert client.post('/v1/partner/signup',json={'email':email,'organisation':'Fixture organisation'}).status_code==202
    path='/v1/admin/partner-applications'
    assert client.get(path).status_code==401
    application=next(row for row in client.get(path,headers=admin).json() if row['email']==email)
    endpoint=f"{path}/{application['id']}/approve"
    assert client.post(endpoint,json={'org_id':'pilot','role':'admin'},headers=admin).status_code==422
    code=client.post(endpoint,json={'org_id':'pilot','role':'analyst'},headers=admin).json()['activation_code']
    activation={'code':code,'password':'Synthetic-Activation-42'}
    assert client.post('/v1/partner/activate',json=activation).status_code==201
    assert client.post('/v1/partner/activate',json=activation).status_code==400
    assert not any(row['email']==email for row in client.get(path,headers=admin).json())


def test_apps_script_individual_access_and_monthly_users(client, admin, monkeypatch):
    app_secret = "synthetic-registry-fixture-abcdef0123456789"
    monkeypatch.setenv("APPS_SCRIPT_REGISTRY_URL", "https://script.google.com/macros/s/test-only/exec")
    monkeypatch.setenv("APPS_SCRIPT_REGISTRY_SECRET", app_secret)
    values = {}
    outgoing = {}
    viewer_email = "new-visitor@example.invalid"
    test_password = "Synthetic-test-fixture-42"

    def transport(request):
        if request.url.host == "script.googleusercontent.com":
            assert request.method == "GET" and request.content == b""
            return httpx.Response(200, json={"ok": True, "verifier": values[request.url.path.lstrip("/")][1]})
        assert request.url.host == "script.google.com" and request.method == "POST"
        body = json.loads(request.content)
        assert hmac.digest(app_secret.encode(), body["payload"].encode(), "sha256").hex() == body["signature"]
        payload = json.loads(body["payload"])
        if payload["action"] == "send_code":
            assert payload["recipient"] == viewer_email
            outgoing[payload["account"]] = payload["code"]
            return httpx.Response(200, json={"ok": True})
        assert viewer_email not in body["payload"] and test_password not in body["payload"]
        if payload["action"] == "store":
            assert payload["verifier"].startswith("gAAAA")
            values[payload["account"]] = (payload["kind"], payload["verifier"])
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(302, headers={"Location": "https://script.googleusercontent.com/" + payload["account"]})

    http_client = httpx.Client
    monkeypatch.setattr("backend.registration_store.httpx.Client", lambda **kwargs: http_client(transport=httpx.MockTransport(transport), **kwargs))
    assert client.get("/v1/facilities").status_code == 401
    path = "/v1/admin/monthly-activity"
    assert client.get(path).status_code == 401
    before = client.get(path, headers=admin).json()["counts"][0]["active_users"]
    issued = client.post("/v1/register/code", json={"email": viewer_email})
    assert issued.status_code == 202 and set(issued.json()) == {"challenge", "expires_in"}
    challenge = issued.json()["challenge"]
    account = {"email": viewer_email, "password": test_password, "challenge": challenge, "code": outgoing[challenge],
               "name": "Synthetic Visitor", "age": 30, "gender": "prefer_not_to_say", "state": "FCT",
               "lga": "Gwagwalada", "phone": "+234 700 000 0001"}
    invalid = client.post("/v1/register", json={**account, "password": "secret-short"})
    assert invalid.status_code == 422 and "secret-short" not in invalid.text
    assert client.post("/v1/register", json={**account, "code": "000000" if account["code"] != "000000" else "000001"}).status_code == 400
    assert client.post("/v1/login", json={"email": viewer_email, "password": test_password}).status_code in (401, 429)
    registered = client.post("/v1/register", json=account)
    assert registered.status_code == 201, registered.text
    visitor = {"Authorization": "Bearer " + registered.json()["token"]}
    assert client.get("/v1/me", headers=visitor).json()["role"] == "individual"
    assert client.get("/v1/facilities", headers=visitor).status_code == 200
    assert client.get(path, headers=visitor).status_code == 403
    assert client.post("/v1/register", json=account).status_code == 400
    assert client.post("/v1/logout", headers=visitor).status_code == 204
    assert client.get("/v1/facilities", headers=visitor).status_code == 401
    from backend import security
    monkeypatch.setattr(security, "limit", lambda *_args, **_kwargs: None)
    signed_in = client.post("/v1/login", json=account)
    assert signed_in.status_code == 200, signed_in.text
    assert client.get(path, headers=admin).json()["counts"][0]["active_users"] == before + 1
    with transaction() as db:
        record = one(db, "SELECT id,password_hash FROM users WHERE email=:email", email=viewer_email)
        profile = one(db, "SELECT demographics,email_verified_at FROM individual_profiles WHERE user_id=:id", id=record["id"])
    assert profile["email_verified_at"] and "Synthetic Visitor" not in profile["demographics"]
    assert reveal(profile["demographics"]) == {"name":"Synthetic Visitor", "age":30, "gender":"prefer_not_to_say",
                                               "state":"FCT", "lga":"Gwagwalada", "phone":"+2347000000001"}
    assert record["password_hash"] == "apps-script:v1" and values[record["id"]][0] == "individual"

    partner_email = "registry-partner@example.invalid"
    applications = "/v1/admin/partner-applications"
    assert client.post("/v1/partner/signup", json={"email": partner_email, "organisation": "Registry test organisation"}).status_code == 202
    application = next(item for item in client.get(applications, headers=admin).json() if item["email"] == partner_email)
    code = client.post(f"{applications}/{application['id']}/approve", headers=admin,
                       json={"org_id": "pilot", "role": "analyst"}).json()["activation_code"]
    activated = client.post("/v1/partner/activate", json={"code": code, "password": test_password})
    assert activated.status_code == 201, activated.text
    assert values[application["id"]][0] == "partner"
    partner = login(client, partner_email, test_password)
    assert client.get("/v1/me", headers=partner).json()["role"] == "analyst"
    assert client.get(path, headers=admin).json()["counts"][0]["active_users"] == before + 2


def test_signup_email_throttle_expiry_and_attempt_limit(client, monkeypatch):
    from backend import registration_email

    clock = [registration_email.now()]
    monkeypatch.setattr(registration_email, "now", lambda: clock[0])
    sent = []
    monkeypatch.setattr(registration_email, "deliver_code", lambda *_args: sent.append(_args[-1]))
    address = "verify-attempts@example.invalid"
    first = client.post("/v1/register/code", json={"email": address}).json()["challenge"]
    assert client.post("/v1/register/code", json={"email": address}).status_code == 429
    expired = sent[-1]
    clock[0] += 601
    with pytest.raises(Exception, match="incorrect or expired"):
        registration_email.check_code(address, first, expired)
    current = client.post("/v1/register/code", json={"email": address}).json()["challenge"]
    correct = sent[-1]
    with pytest.raises(Exception, match="incorrect or expired"):
        registration_email.check_code("other@example.invalid", current, correct)
    wrong = "000000" if correct != "000000" else "000001"
    for _ in range(5):
        with pytest.raises(Exception, match="incorrect or expired"):
            registration_email.check_code(address, current, wrong)
    with pytest.raises(Exception, match="incorrect or expired"):
        registration_email.check_code(address, current, correct)
