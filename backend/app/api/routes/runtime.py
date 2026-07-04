from fastapi import APIRouter, HTTPException, status

from app.schemas import RuntimeCheckRead, RuntimeInstallRead, RuntimeInstallRequest
from app.services import runtime as runtime_service

router = APIRouter(prefix="/api/runtime", tags=["runtime"])


@router.get("/check", response_model=RuntimeCheckRead)
def get_runtime_check() -> dict:
    return runtime_service.check_runtime()


@router.post("/install", response_model=RuntimeInstallRead)
def install_runtime_profile(payload: RuntimeInstallRequest) -> dict:
    try:
        return runtime_service.install_runtime(payload.profile)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
