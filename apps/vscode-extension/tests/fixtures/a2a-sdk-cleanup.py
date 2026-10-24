# Extracted verbatim AST methods from public a2a-python v1.2.3 (44b2f761a99123370237afe6c828f4cd2a50c402).
# No SDK dependency integration proof; fake collaborators only.

class ExtractedHandler:

    async def aclose(self) -> None:
        """Shuts down the handler, draining all active tasks.

        Drains the ``ActiveTaskRegistry`` so a server shutdown leaves no
        pending ``asyncio.Task``. Intended to be wired into an ASGI
        ``lifespan`` / ``on_shutdown`` hook. Safe to call multiple times.
        """
        await self._active_task_registry.aclose()

    async def on_message_send(  # noqa: D102
        self,
        params: SendMessageRequest,
        context: ServerCallContext,
    ) -> Message | Task:
        active_task, request_context = await self._setup_active_task(
            params, context
        )
        task_id = cast('str', request_context.task_id)

        result: Message | Task | None = None

        async for raw_event in active_task.subscribe(
            request=request_context,
            include_initial_task=False,
            replace_status_update_with_task=True,
        ):
            event = raw_event
            logger.debug(
                'Processing[%s] event [%s] %s',
                params.message.task_id,
                type(event).__name__,
                event,
            )
            if isinstance(event, Task) and (
                params.configuration.return_immediately
                or event.status.state
                in (TERMINAL_TASK_STATES | INTERRUPTED_TASK_STATES)
            ):
                self._validate_task_id_match(task_id, event.id)
                result = event
                # A FAILED task may be followed by a producer exception. Keep
                # the task as the fallback result, but let the subscription
                # surface that exception or finish the current request.
                if (
                    params.configuration.return_immediately
                    or event.status.state != TaskState.TASK_STATE_FAILED
                ):
                    # AgentExecutor will continue to run in the background
                    # when return_immediately is set.
                    break

            if isinstance(event, Message):
                result = event
                # Do NOT break here as Message is supposed to be the only
                # event in "Message-only" interaction.
                # ActiveTask consumer (see active_task.py) validates the event
                # stream and raises InvalidAgentResponseError if more events are
                # pushed after a Message.

        if result is None:
            logger.debug('Missing result for task %s', request_context.task_id)
            result = await active_task.get_task()

        if isinstance(result, Task):
            result = apply_history_length(result, params.configuration)

        logger.debug(
            'Returning result for task %s: %s',
            request_context.task_id,
            result,
        )
        return result

class ExtractedRegistry:

    async def _remove_task(self, task_id: str) -> None:
        with self._lock:
            self._active_tasks.pop(task_id, None)
            logger.debug('Removed active task for %s from registry', task_id)

    async def aclose(self) -> None:
        """Closes the registry and drains all active tasks.

        Marks the registry closed so ``get_or_create`` refuses new work, then
        force-closes every registered ``ActiveTask`` and awaits the in-flight
        ``_remove_task`` cleanup tasks they schedule, so no SDK-owned
        ``asyncio.Task`` is left pending at event-loop shutdown. Safe to call
        multiple times.

        The close flag is set and the active-task snapshot is taken under
        ``_lock``, then the lock is released before awaiting the drain. Marking
        closed under the same lock prevents a concurrent ``get_or_create`` from
        registering a task that the drain would miss.
        """
        with self._lock:
            self._closed = True
            active_tasks = list(self._active_tasks.values())

        if active_tasks:
            results = await asyncio.gather(
                *(task.aclose() for task in active_tasks),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, Exception):
                    logger.error('Error draining active task', exc_info=result)

        cleanup_tasks = list(self._cleanup_tasks)
        if cleanup_tasks:
            await asyncio.gather(*cleanup_tasks, return_exceptions=True)

        with self._lock:
            self._active_tasks.clear()

class ExtractedActive:

    async def aclose(self) -> None:
        """Force-closes the task's queues and drains its background tasks.

        Provides a bounded, public teardown for the producer and consumer
        ``asyncio.Task``s spawned in ``start()``. Without it, a producer
        wedged in its ``finally`` closing an abandoned subscriber sink can
        survive until event-loop shutdown and surface as
        ``Task was destroyed but it is pending!``.

        Always forces: the queues are closed with ``immediate=True`` and the
        background tasks are cancelled, so teardown is bounded even when a
        subscriber sink was never drained. It is safe to call multiple times.
        """
        # Shut down the request queue first, mirroring the producer's
        # ``finally``. If `start()` was never called, the producer/consumer
        # ``finally`` blocks never run, and without this a caller parked in
        # `enqueue_request()` would wait forever.
        self._request_queue.shutdown(immediate=True)
        await self._event_queue_agent.close(immediate=True)
        await self._event_queue_subscribers.close(immediate=True)
        # Set `_is_finished` and collect the background tasks under `_lock` so
        # this is mutually exclusive with `start()`, which refuses to spawn
        # once `_is_finished` is set. The lock is released before awaiting the
        # tasks, because their teardown re-acquires it.
        async with self._lock:
            self._is_finished.set()
            background_tasks = [
                task
                for task in (self._producer_task, self._consumer_task)
                if task is not None
            ]
            for task in background_tasks:
                task.cancel()
        if background_tasks:
            results = await asyncio.gather(
                *background_tasks, return_exceptions=True
            )
            for result in results:
                # CancelledError is a BaseException, so it is excluded here.
                if isinstance(result, Exception):
                    logger.error('Error during aclose', exc_info=result)

def build_error_response(
    request_id: str | int | None,
    error: A2AError | JSONRPCError,
) -> dict[str, Any]:
    """Build a JSON-RPC error response dict.

    Args:
        request_id: The ID of the request that caused the error.
        error: The A2AError or JSONRPCError object.

    Returns:
        A dict representing the JSON-RPC error response.
    """
    jsonrpc_error: JSONRPCError
    if isinstance(error, JSONRPCError):
        jsonrpc_error = error
    elif isinstance(error, A2AError):
        error_type = type(error)
        model_class = EXCEPTION_MAP.get(error_type, JSONRPCInternalError)
        code = JSON_RPC_ERROR_CODE_MAP.get(error_type, -32603)
        jsonrpc_error = model_class(
            code=code,
            message=str(error),
            data=build_error_details(error),
        )
    else:
        jsonrpc_error = JSONRPCInternalError(message=str(error))

    error_dict = jsonrpc_error.model_dump(exclude_none=True)
    return JSONRPC20Response(error=error_dict, _id=request_id).data
