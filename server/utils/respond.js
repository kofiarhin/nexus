export function ok(res, data, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    requestId: res.locals.requestId
  });
}

export function created(res, data) {
  return ok(res, data, 201);
}
