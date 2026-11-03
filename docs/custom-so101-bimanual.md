# Physical AI Studio — SO-101 양팔 커스텀 배포판

> 이 문서는 회사에서 직접 수정한 Physical AI Studio 포크의 **추가 기능과 설치·업데이트 방법**입니다. 공식 프로젝트의 일반 설치 문서와 다릅니다.
>
> 기준: 2026-11-03 / 베이스 커밋 `bc5e91f030da0bd7eef27d4f9c67e6aa713857c3` + 로컬 커스텀 변경(모델 관리·DINOv2 ACT·양팔 직접 등록·메트릭 수정 포함, 미커밋) / Ubuntu x86_64 (amd64)

## 빠른 시작

배포 폴더 **전체**를 대상 Ubuntu PC에 복사하고, 해당 디렉터리에 새로 진입해서 실행합니다.

```bash
cd ~/physical-ai-studio-bimanual
# Intel CPU / Panther Lake 로봇 PC
bash install-cpu.sh
# 또는 NVIDIA RTX 4090 PC
bash install-gpu.sh
```

- 위 두 스크립트 중 **환경에 맞는 것 하나만** 실행합니다. Docker가 없으면 설치하고, 기존 Docker와 도구가 있으면 재사용합니다.
- 기존 컨테이너를 재생성할 때 `y/N` 확인을 받습니다. **진행 중인 수집·학습·추론과 로봇 동작을 안전하게 중지**한 후 승인하세요.
- 성공하면 브라우저에서 <http://127.0.0.1:7860>으로 접속합니다. 원격 접속을 열었다면 LAN 접근 제어가 필요합니다.
- 이전 배포 디렉터리를 `mv`로 교체했다면, **열려 있던 터미널에서 `cd`로 새 경로에 다시 진입**하세요. 프롬프트 경로가 같아 보여도 옛 디렉터리의 스크립트를 실행할 수 있습니다.

## 이 포크에서 추가한 기능

### 1. Models → Import model (ZIP 자동 등록)

기존에는 압축을 풀고 `docker cp`, `physicalai-studio models import-dir` CLI로 등록해야 했지만, 이 포크는 웹 UI에서 Import할 수 있습니다.

1. 가져올 프로젝트의 **Models** 화면을 엽니다. 오른쪽 위 `Import model`과 `Train model` 버튼은 **가로 배치**입니다.
2. **Import model → Choose ZIP file**에서 Physical AI Studio의 **모델 전체 다운로드 ZIP**을 선택합니다.
3. 기본 모델 이름을 확인하거나 변경합니다.
4. **Link to local dataset**에서 이 프로젝트의 로컬 데이터셋을 지정합니다. 프로젝트에 데이터셋이 하나면 기본 선택되고, 여러 개면 수동 선택합니다.
5. **Import model**을 눌러 업로드·검사·DB 등록을 수행합니다. 완료 후 Models 목록에서 확인합니다.

**ZIP 구성:** 일반적으로 `model.ckpt`와 `exports/<backend>/manifest.json` 및 해당 아티팩트가 포함되어야 합니다. 단일 상위 폴더(`ACT/model.ckpt` 등)가 있는 ZIP도 허용합니다. 손상·위험 ZIP 및 업로드/압축 해제 용량 초과는 거부합니다. 기존 모델을 덮어쓰지 않으므로 동일 모델을 여러 번 가져오면 중복이 생길 수 있습니다.

**중요 — 데이터셋을 연결하는 이유:** 모델 다운로드 ZIP의 `manifest.json`에는 정책 이름, 입력/출력 특징 및 백엔드 파일 등이 있지만 **원본 학습 데이터셋의 프로젝트/데이터셋/로봇 환경 ID는 없습니다.** 따라서 선택한 데이터셋은 *대상 PC에서 모델을 연결할 로컬 데이터셋*이지 원본 학습 데이터셋임을 증명하는 값이 아닙니다. 카메라 이름·개수, 상태/액션 차원, 관절 순서·단위, 로봇 환경을 **실기체 추론 전 별도로 검증**해야 합니다.

**예시 작업 흐름:** RTX 4090 GPU PC에서 양팔 ACT 학습 및 PyTorch/OpenVINO Export → 전체 모델 ZIP 다운로드 → Panther Lake PC의 SO-101 프로젝트에서 Import → 로컬 호환 데이터셋 연결 → 추론 환경 및 백엔드 검사 → 실기체 테스트. *OpenVINO 모델이 있다고 Intel GPU/NPU 추론이 자동 지원되는 것은 아닙니다.*

### 2. ACT 학습·추론 UI 추가 기능 (2026-11-03)

- **Train Model → Batch Size:** 기존 슬라이더를 유지하면서 `1, 2, 4, 8, 16, 32, 64, 96, 112, 128, 160, 192, 224, 256` 선택 가능. Auto도 유지합니다.
- **Train Model → Data Workers:** 기존 드롭다운을 유지하면서 `Auto, 0, 1, 2, 4, 6, 8, 10, 12, 14, 16` 선택 가능.
- **Batch Auto**는 실제 짧은 학습을 통해 실행 가능한 Batch Size를 탐색하며, **Workers Auto**는 CPU 논리 코어 수와 8 중 작은 값을 사용합니다.
- **Inference → ACT Replan Interval:** 실행 간격 변경 및 현재 적용값 확인, 기본 100프레임.
- **Inference → Diagnostics:** 추론 중 로봇 상태·전송 Action을 CSV로 기록·다운로드. 기록은 `/app/storage/diagnostics/`에 저장되며 원본 모델의 예측 Action Chunk 전체를 저장하는 기능은 아닙니다.
- Batch Size 128은 회사 RTX 4090 환경에서 Auto 탐색 중 메모리 부족으로 실패했으며, 배치 112에서는 실제 학습이 진행되는 것을 확인했습니다. 큰 값의 선택 가능 여부는 **학습 완료·성능·안정성을 보장하지 않습니다**.

### 3. ACT Vision Backbone 선택 — ResNet18 / DINOv2 (2026-11-03)

- 새 ACT 모델 학습 시 **Models → Train model → Training Parameters → Vision Backbone**에서 `ResNet18 (default)`, `DINOv2-S/14 (frozen encoder)`, `DINOv2-B/14 (frozen encoder)`를 선택합니다. 이미 학습한 모델의 **재학습(Resume)**에서는 백본을 다시 선택하지 않고 체크포인트에 저장된 구조를 사용합니다.
- **Frozen encoder**: DINOv2 사전학습 가중치는 고정하고, 패치 특징을 ACT의 `dim_model`(기본 512)으로 투영하는 어댑터와 ACT 정책을 학습합니다. DINOv2-S/14는 384차원, B/14는 768차원 패치 특징을 사용합니다.
- DINO 학습 시 카메라 입력은 224×224로 전처리됩니다. 기존 데이터셋은 재수집하지 않고 사용할 수 있지만, 카메라/로봇 관절 구조가 해당 데이터셋과 일치해야 합니다. 기존 ResNet18 체크포인트에서 DINO로 백본을 바꿔 이어서 학습할 수는 없습니다.
- DINOv2 최초 **새 모델 학습 시** 공개 Hugging Face 모델(`facebook/dinov2-small`, `facebook/dinov2-base`) 사전학습 가중치를 다운로드하므로 네트워크 접근이 필요합니다. 다운로드된 가중치는 기본적으로 `/app/storage/model-cache/dinov2`에 캐시하여 **기존 named volume**과 함께 유지합니다. 별도로 `PAI_DINOV2_CACHE_DIR` 환경 변수로 경로를 지정할 수 있습니다.
- 학습한 체크포인트와 PyTorch Export(`exports/torch`)에는 DINO 백본 가중치가 포함되며, **추론 시에는 해당 체크포인트와 저장된 설정으로 자동 복원**합니다. 추론 화면에서 비전 백본을 다시 고르지 않습니다.
- **DINO 기반 ACT의 검증된 내보내기는 PyTorch(`torch`)만 지원**합니다. 이 빌드에서 DINO의 ONNX·OpenVINO·ExecuTorch Export는 검증하지 않아 선택을 제한했습니다. 기존 ResNet18은 기존 내보내기 선택지를 유지합니다. 따라서 **Intel CPU 전용 PC에서 DINO 모델을 사용할 때도 PyTorch 추론 경로를 사용**하며, OpenVINO/NPU 가속이 되는 것으로 간주하지 마세요.
- 회사 RTX 4090 PC에서 DINOv2-S/B **특징 추출·투영**, DINOv2-S **추론·체크포인트 저장/복원·PyTorch Export 재로딩**, Train UI 테스트 43개와 새 이미지 서버 기동/API 확인을 수행했습니다. **실제 데이터셋으로 전체 학습 완료, 물체 파지 성공률, Intel CPU 로봇 PC 추론은 아직 검증하지 않았습니다.**
- DINOv2-B는 S보다 큰 모델이므로 학습 시 GPU 메모리 사용량과 처리량을 확인하세요. 첫 실험은 DINOv2-S와 작은 Batch Size(예: 4)를 권장합니다. 그림자 오인식 개선은 검증 대상이지 보장된 결과가 아닙니다.

### 4. Models → 모델 검색 및 메타데이터 관리 (2026-11-03)

- **Models 화면 검색:** 모델 이름, 설명(Description), 태그(Tag)를 검색합니다. 검색어에 일치하는 모델만 목록에 표시합니다.
- **필터:** Architecture/Policy와 Tag별로 모델을 좁혀 볼 수 있습니다.
- **정렬:** 최신순·오래된순·이름순·버전순을 선택할 수 있으며, 현재 검색 결과 개수도 표시합니다.
- **모델 정보 수정:** 모델 행 오른쪽 `⋮ → Edit model`에서 **이름·설명·태그**를 수정합니다. 실행 파일, 학습 설정, 원본 데이터셋, 모델 경로·버전은 이 작업으로 변경되지 않습니다.
- **버전 표시:** 모델 행에 `v1`, `v2` 등 버전 배지를 표시합니다. 버전은 읽기 전용이며 이름 수정으로 증가하지 않습니다.
- **입력 제약:** 이름 1~200자, 설명 최대 2,000자, 태그 최대 10개(각 40자 이내)입니다.

### 5. Robots → SO-101 양팔 직접 등록 (2026-11-03)

- `Robots → Add robot → Bimanual SO101 Follower/Leader`의 **Setup method**에서 두 가지 방식을 선택합니다.
  - **기존 방식:** 단일 SO-101 두 대를 각각 등록·캘리브레이션한 다음 왼팔/오른팔을 조합합니다.
  - **직접 등록:** USB 시리얼 번호로 왼팔·오른팔 컨트롤러를 선택한 뒤, **왼팔 진단 → 필요 시 모터 설정 → 캘리브레이션 → 검증 → 오른팔 동일 과정 → 양팔 로봇 하나로 저장**합니다.
- 서로 다른 시리얼 번호를 가진 컨트롤러 두 개가 필요합니다. 좌·우 캘리브레이션은 `left_calibration`과 `right_calibration`으로 따로 저장됩니다. 이미 캘리브레이션된 팔은 진단 결과에 따라 재캘리브레이션 없이 검증으로 넘어갈 수 있습니다.
- **실제 두 팔을 연결한 모터 설정·캘리브레이션·재연결 테스트는 아직 수행하지 않았습니다.** 케이블·전원·팔 방향을 확인하고 가동 공간을 확보한 뒤 테스트하세요.

### 6. 학습 메트릭 그래프 표시 수정 (2026-11-03)

- 학습 시작 직후 `metrics.csv`가 생성되기 전에 메트릭 화면을 열면 빈 결과가 계속 유지되던 문제를 수정했습니다.
- 로컬 메트릭 스트림은 파일이 생성될 때까지 기다리며, UI는 과거 빈 응답을 영구적으로 캐시하지 않습니다.
- 이미 기록된 Loss/Learning Rate 데이터는 변경하지 않습니다. 이 수정의 자동 테스트는 일부 환경 의존성으로 미실행이며, 새 이미지의 서버 기동 및 기존 데이터 보존은 검증했습니다.

### 7. USB용 CPU/GPU 설치 스크립트

| 파일 | 역할 |
| --- | --- |
| `install-cpu.sh` | Intel/CPU PC에서 NVIDIA CUDA 없이 실행 |
| `install-gpu.sh` | NVIDIA 드라이버·Container Toolkit 확인, Docker에 `--gpus all` 적용 |
| `IMAGE-ID` | 이번 배포 이미지의 **정확한 sha256 ID**. `latest` 태그가 있어도 이미지 내용이 다른지 판단 |
| `physical-ai-studio-bimanual.part-00` ~ `part-03` | Docker `save` 결과를 zstd 압축한 분할 파일. 데이터셋/모델/DB는 미포함 |
| `PARTS-SHA256SUMS` | 각 분할 파일 체크섬 |
| `SHA256SUMS` | 결합된 `physical-ai-studio-bimanual.tar.zst` 체크섬 |

설치 스크립트는 필요한 도구 확인 → Docker 접근(필요 시 `sudo` 인증) → 이미지 ID 확인/결합/검증/`docker load` → 저장 볼륨 결정 → 호스트 장치 그룹/USB/카메라 연결 → 기존 컨테이너 재생성 확인 → GPU 장치 검증(GPU 스크립트만) → HTTP API/카메라 검색 확인 순서로 실행됩니다. 실제 GPU 스크립트에서는 GPU 접근 검사가 기존 컨테이너 확인보다 먼저 수행됩니다.

### 8. 새 이미지로 업데이트하면서 기존 데이터 보존

- 설치 후 Docker 이미지의 **이름/태그는 고정**: `physical-ai-studio-bimanual:latest` (CPU/GPU 공통 동일 이미지). 배포 아카이브 내부의 원본 태그는 `physical-ai-studio-bimanual:direct-setup-20261103`이며, 설치 스크립트가 `IMAGE-ID`의 정확한 이미지를 `latest`로 태그합니다.
- **`latest` 자체가 볼륨을 지정하거나 업데이트하지는 않습니다.** 스크립트의 `/app/storage` 마운트가 프로젝트/데이터셋/모델/SQLite DB 저장소를 결정합니다.
- 기존 **운영 컨테이너 `physical-ai-studio-bimanual`**가 있으면 그 컨테이너에 연결된 **named volume**을 최우선으로 재사용합니다.
- 운영 컨테이너가 없는 경우에만 레거시 `physical-ai-studio-bimanual-test`의 named volume을 탐색합니다. 이 테스트 컨테이너가 아직 실행 중이면 중지 전 별도의 `y/N` 확인을 받으며, 컨테이너 자체는 삭제하지 않습니다.
- 둘 다 없으면 `physical-ai-studio-bimanual-storage`를 사용합니다. 같은 이름의 볼륨이 존재하면 Docker가 재사용하고, 없으면 새로 생성합니다.
- 기존 **운영 컨테이너만** 사용자 확인 후 `stop → rm → run` 합니다. `docker volume rm`이나 `docker system prune --volumes`는 수행하지 않습니다. 단, `/app/storage` 외부에 사용자가 수동으로 지정한 마운트나 환경 변수는 자동 복원하지 않습니다.
- 다른 프로그램이 7860 포트를 사용한다면 자동 종료하지 않고 오류로 중단합니다. **고정 태그의 이미지 ID가 바뀌었는지 여부**는 `IMAGE-ID`와 비교합니다. 기존 이미지가 같은 버전이면 재로드를 건너뜁니다.
- NVIDIA 스크립트는 Toolkit이 필요할 때 Docker 서비스를 재시작할 수 있습니다. GPU/CPU 양쪽 다 `--network host`, `--ipc host`, `--privileged`를 사용하므로 **신뢰할 수 있는 전용 장치**에서만 실행하세요.

**회사 PC 실제 저장소 사례 (로봇 PC와 혼동 금지)**

```text
physical-ai-studio-bimanual (운영 컨테이너)
  └── /app/storage ← pai-storage (기존 프로젝트·모델 보존)
```

**로봇 PC**에는 기존 named volume `physical-ai-studio-bimanual-storage`와 수집 데이터 15 에피소드/8,557 프레임이 있으므로 절대 삭제하지 마세요. 배포 ZIP/이미지에는 이 데이터가 담겨 있지 않습니다.

## 기존 PC에 배포 파일 덮어쓰기

기존 `~/physical-ai-studio-bimanual` 디렉터리를 통째로 삭제하지 마세요. 기존 `ACT/` 등 별도 파일이 있을 수 있습니다. **다음 배포 파일만** 새 버전으로 복사합니다.

```text
install-cpu.sh
install-gpu.sh
IMAGE-ID
README.md
PARTS-SHA256SUMS
SHA256SUMS
physical-ai-studio-bimanual.part-00
physical-ai-studio-bimanual.part-01
physical-ai-studio-bimanual.part-02
physical-ai-studio-bimanual.part-03
```

이전 설치에서 결합된 `physical-ai-studio-bimanual.tar.zst`가 남아 있어도 스크립트가 체크섬을 비교해 오래된 파일이면 다시 결합합니다. 새 배포는 위의 **10개 파일을 세트로 유지**해야 합니다. 설치 후에도 named volume은 별도로 보존합니다.

## 점검 및 문제 해결

```bash
# 실제 실행 컨테이너의 이미지와 연결된 볼륨 확인
docker inspect physical-ai-studio-bimanual --format '{{.Config.Image}} {{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}'
# 실행 중인 컨테이너/이미지 확인
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
# 백엔드/API 확인
curl -fsS http://127.0.0.1:7860/api/health
curl -fsS 'http://127.0.0.1:7860/api/hardware/cameras?all=true'
# 장애 조사
docker logs --tail 150 physical-ai-studio-bimanual
# 분할 파일 검사
sha256sum -c PARTS-SHA256SUMS
```

- Docker 접근 권한이 없다면 `docker` 대신 `sudo docker`로 확인하세요. 스크립트는 필요한 경우 인증을 요청합니다.
- **UI가 옛날 화면이라면** 실제 이미지 ID·컨테이너 상태·7860 포트 점유를 먼저 확인하세요. `physical-ai-studio-bimanual-test`가 남아 7860을 사용하는 경우가 있었습니다. 브라우저 캐시라고 먼저 단정하지 마세요.
- **Vision Backbone 선택창이 보이지 않으면** `Models → Train model → Training Parameters` 화면인지, 실제 실행 이미지가 `IMAGE-ID`의 이미지인지 확인하고 브라우저를 강력 새로고침(`Ctrl+Shift+R`)하세요.
- **프로젝트가 사라져 보이면** 새 컨테이너의 `/app/storage` 볼륨 이름을 기존 컨테이너/백업 볼륨과 비교하세요. 다른 볼륨 연결이 원인이었으며 실제 파일을 삭제한 것이 아니었습니다. 데이터를 복사하거나 볼륨을 제거하기 전 확인해야 합니다.
- **Docker 이미지와 USB의 분할 파일만으로 데이터셋이 복구되는 것은 아닙니다.** 백업은 Docker named volume/DB 기준으로 별도 수행해야 합니다.
- 컨테이너가 실행 중이어도 `GET /api/health` 응답이 다른 컨테이너에서 온 것이 아닌지 확인해야 합니다. 동일한 호스트 7860 포트를 두 서버가 동시에 사용할 수 없습니다.

## 현재 검증 범위 및 제약

- 회사 RTX 4090 PC: ZIP Import API 등록 및 UI 빌드 확인. ACT 추론 옵션·진단 CSV·학습 슬라이더/드롭다운·DINO 선택 기능을 포함한 Docker 이미지가 실행되어 API 응답 HTTP 200을 확인했습니다. CPU 로봇 PC에서의 동일 이미지 실행 및 실기체 검증은 별도입니다.
- 이번 배포 이미지 ID는 `IMAGE-ID` 기준입니다. 회사 운영 컨테이너는 `direct-setup-20261103` 이미지로 교체했고 HTTP 200, RTX 4090 접근, 프로젝트 1개·모델 4개·데이터셋 3개 보존을 확인했습니다. 모델 관리 UI와 양팔 직접 등록의 실제 브라우저 조작·실기체 검증은 별도로 필요합니다.
- 양팔 SO-101 로봇 PC: 기존 수동 ACT Import 성공 보고, 15 에피소드/8,557 프레임 수집 확인. 이 최신 빌드의 CPU 설치와 실제 모델 ZIP 업로드/추론은 미검증입니다.
- 기능은 업로드/등록 자동화를 제공하나, 업로드 퍼센트 표시와 취소 기능은 아직 없습니다.
- 실제 데이터셋과 모델은 이미지에 내장되지 않습니다. 모델의 로봇 적합성·좌표계·입출력 스펙 검증 및 수동 캘리브레이션은 별도 책임입니다.
