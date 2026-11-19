import os
from tempfile import TemporaryDirectory

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
from backend.core import engine, one, transaction
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

def test_mock_and_official_adapter(client,monkeypatch):
    path="/v1/postcodes/lookup"
    result=client.post(path,json={"postcode":"zz01a01zz01"}).json()
    assert result["source"]=="local_mock" and result["location"]["lat"]==10.52
    assert client.post(path,json={"postcode":"wrong"}).status_code==422
    monkeypatch.setenv("NIPOST_API_KEY","nipost_test_mock_fixture")
    provider=httpx.AsyncClient
    def transport(request):
        assert request.url.host=="api.postcode.gov.ng"
        assert request.url.path=="/v1/lookup"
        assert request.url.params["level"]=="1"
        assert request.headers["X-API-Key"]=="nipost_test_mock_fixture"
        return httpx.Response(200,json={"data":{"valid":True}})
    monkeypatch.setattr("backend.postcodes.httpx.AsyncClient",lambda **kw: provider(transport=httpx.MockTransport(transport),**kw))
    result=client.post(path,json={"postcode":"FC-01-A01-KP-27"})
    assert result.json()=={"valid":True,"source":"nipost_test","location":None,"postcode":"FC-01-A01-KP-27"}
    monkeypatch.setattr("backend.postcodes.httpx.AsyncClient",lambda **kw: provider(transport=httpx.MockTransport(lambda _:httpx.Response(429)),**kw))
    assert client.post(path,json={"postcode":"FC-01-A01-KP-27"}).status_code==503

def test_facilities(client,admin):
    assert not save_facility(client,admin,"test-phc")["published"]
    assert client.get("/v1/facilities/test-phc").status_code==404
    assert save_facility(client,admin,"test-phc",verified_at="2024-01-01")["published"]
    result=client.get("/v1/facilities",params={"lat":10.52,"lon":7.44,"category":"phc","q":"TEST"})
    assert result.status_code==200,result.text
    assert result.json()[0]["distance_km"]==pytest.approx(0,abs=.001)
    assert client.get("/v1/facilities?lat=10.52").status_code==422
    assert client.post("/v1/facilities/test-phc/route",json={"lat":10.52,"lon":7.44}).status_code==503

def test_emergency_cycle_and_access(client,admin):
    org=new_org(client,admin,"Synthetic dispatch team")
    responder_id,responder=new_user(client,admin,org,"responder","responder")
    _,dispatcher=new_user(client,admin,org,"dispatcher","dispatcher")
    body={"category":"maternal","landmark":"synthetic landmark","synthetic":False}
    assert client.post("/v1/incidents",json=body).status_code==422
    body["synthetic"]=True
    res=client.post("/v1/incidents",json=body)
    assert res.status_code==201,res.text
    data=res.json()
    assert data["dispatch_enabled"] is False
    record=data["id"]
    ops="/v1/ops/incidents/"+record
    track="/v1/incidents/"+record+"/track"
    assert client.post(track,headers={"X-Tracking-Key":"wrong"}).status_code==404
    assert client.post(track,headers={"X-Tracking-Key":data["tracking_key"]}).json()["status"]=="submitted"
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

def test_revocation_and_rate_limit(client):
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
    res=client.post("/v1/facilities/osrm-fixture/route",json={"lat":10.5,"lon":7.46})
    assert res.json()=={"minutes":7,"km":2.4}


def test_submission_retries_reuse_the_reference(client):
    import uuid
    key=str(uuid.uuid4())
    headers={"X-Tracking-Key": key}
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