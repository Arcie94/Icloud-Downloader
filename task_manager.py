import uuid
import threading
import queue
import json

class TaskManager:
    """Manages background tasks and their Server-Sent Events (SSE) queues."""
    def __init__(self):
        self.tasks = {}

    def start_task(self, prefix, target_func, *args, **kwargs):
        """
        Starts a background task.
        target_func must accept `progress_callback` and `cancel_check` kwargs.
        """
        task_id = f"{prefix}-{str(uuid.uuid4())[:8]}"
        event_queue = queue.Queue()
        cancel_event = threading.Event()

        self.tasks[task_id] = {
            "status": "running",
            "events": event_queue,
            "cancel": cancel_event,
        }

        def progress_callback(event_type, data_dict):
            event_queue.put((event_type, data_dict))

        def cancel_check():
            return cancel_event.is_set()

        def run_wrapped():
            try:
                target_func(*args, progress_callback=progress_callback, cancel_check=cancel_check, **kwargs)
            except Exception as e:
                event_queue.put(("error_event", {"message": str(e)}))
            finally:
                event_queue.put(("__done__", {}))
                self.tasks[task_id]["status"] = "completed"

        thread = threading.Thread(target=run_wrapped, daemon=True)
        thread.start()

        return task_id

    def cancel_task(self, task_id):
        """Signals a task to cancel."""
        task = self.tasks.get(task_id)
        if task:
            task["cancel"].set()
            return True
        return False

    def stream_task_events(self, task_id, timeout=30):
        """Generator for SSE event stream."""
        task = self.tasks.get(task_id)
        if not task:
            return None

        event_queue = task["events"]
        while True:
            try:
                event_type, data = event_queue.get(timeout=timeout)
                if event_type == "__done__":
                    break
                yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
            except queue.Empty:
                # Send keepalive to prevent proxy timeout
                yield f": keepalive\n\n"

# Global task manager instance
task_manager = TaskManager()
