import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.schemas import LocalPathOpenRead, LocalPathOpenRequest
from app.services.storage import StoragePaths

router = APIRouter(prefix="/api/local-files", tags=["local-files"])


def _managed_projects_root() -> Path:
    return (StoragePaths(settings.artifact_root).ensure_root() / "projects").resolve()


def _is_relative_to(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _open_command(path: Path) -> list[str]:
    if sys.platform == "darwin":
        return ["open", str(path)]
    if sys.platform.startswith("win"):
        return ["explorer", str(path)]
    return ["xdg-open", str(path)]


@router.post("/open", response_model=LocalPathOpenRead)
def open_local_path(payload: LocalPathOpenRequest) -> dict[str, str]:
    requested_path = Path(payload.path).expanduser().resolve()
    managed_root = _managed_projects_root()
    if not _is_relative_to(requested_path, managed_root):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="VisionOps 관리 저장소 안의 경로만 열 수 있습니다.",
        )
    if not requested_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="경로를 찾을 수 없습니다.",
        )

    open_path = requested_path if requested_path.is_dir() else requested_path.parent
    try:
        subprocess.Popen(_open_command(open_path))
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="파일 탐색기를 열지 못했습니다.",
        ) from exc

    return {
        "requested_path": str(requested_path),
        "opened_path": str(open_path),
    }
