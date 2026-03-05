from fastapi import APIRouter

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


@router.get("/")
async def get_schedule():
    return {"status": "not_implemented"}


@router.post("/generate")
async def generate_schedule():
    return {"status": "not_implemented"}


@router.get("/calendar/events")
async def get_calendar_events():
    return {"status": "not_implemented"}


@router.post("/calendar/events")
async def create_calendar_event():
    return {"status": "not_implemented"}
