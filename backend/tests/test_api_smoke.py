def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_preflight_allows_frontend_origin(client):
    response = client.options(
        "/api/projects",
        headers={
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
            "Origin": "http://127.0.0.1:5173",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_openapi_includes_core_routes(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]

    assert "/api/projects" in paths
    assert "/api/projects/{project_id}/datasets" in paths
    assert "/api/projects/{project_id}/datasets/{dataset_id}/splits" in paths
    assert "/api/projects/{project_id}/training-runs" in paths
    assert "/api/projects/{project_id}/inference-runs" in paths
