"""Fulfillment Hub API."""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .db import db_exists_and_seeded, upgrade_existing
from .routers import inventory, issues, orders, processing, system, warehouse
from .services.common import DomainError

@asynccontextmanager
async def lifespan(_app):
    """First run: create and seed the demo database automatically."""
    if not db_exists_and_seeded():
        from .seed import reset_database
        reset_database()
    else:
        upgrade_existing()
    yield


app = FastAPI(title="Fulfillment Hub API", version="1.0.0", lifespan=lifespan,
              description="Order fulfillment for a small e-commerce warehouse: visibility, prevention, exceptions.")

origins = [o.strip().rstrip("/") for o in
           os.getenv("FH_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
# Optional pattern, e.g. https://.*\.vercel\.app, so preview deployments can call the API too.
# Not needed on Vercel: the frontend and backend share one domain (see vercel.json), so calls are same-origin.
origin_regex = os.getenv("FH_CORS_ORIGIN_REGEX") or None
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_origin_regex=origin_regex,
                   allow_credentials=False, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError):
    """Business-rule rejections come back as friendly JSON the UI can show as-is."""
    return JSONResponse(status_code=exc.status, content={"detail": exc.message, "code": exc.code, **exc.details})


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception):
    import logging
    logging.getLogger("fulfillment_hub").exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server. Please try again.",
                                                  "code": "server_error"})


for r in (system.router, orders.router, processing.router, warehouse.router, inventory.router, issues.router):
    app.include_router(r)
