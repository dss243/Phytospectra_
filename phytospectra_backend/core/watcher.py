import asyncio
import logging
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from core.config import settings

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = ('.tif', '.tiff', '.jpg', '.jpeg', '.png')


class ImageHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.processing = set()

    def on_created(self, event):
        if event.is_directory:
            return
        path = event.src_path
        if not path.lower().endswith(SUPPORTED_EXTENSIONS):
            return
        if path in self.processing:
            return

        self.processing.add(path)
        logger.info(f"New image detected: {path}")

        # Schedule async pipeline on the event loop
        asyncio.run_coroutine_threadsafe(
            self._run_pipeline(path), self.loop
        )

    async def _run_pipeline(self, path: str):
        # Small delay to ensure file is fully written
        await asyncio.sleep(1.5)
        try:
            from services.pipeline import process_image
            await process_image(path)
        except Exception as e:
            logger.error(f"Pipeline error for {path}: {e}")
        finally:
            self.processing.discard(path)


async def start_watcher():
    folder = settings.WATCHED_FOLDER
    os.makedirs(folder, exist_ok=True)
    loop = asyncio.get_event_loop()

    handler  = ImageHandler(loop)
    observer = Observer()
    observer.schedule(handler, path=folder, recursive=False)
    observer.start()

    logger.info(f"Watching folder: {folder}")

    try:
        while True:
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        observer.stop()
    observer.join()