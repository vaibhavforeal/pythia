// An error carrying the HTTP status a route should answer with.
//
// Lives in its own module because both server/birth.js and server/index.js
// throw it, and `instanceof` only works when every thrower and catcher is
// looking at the same class object. Two modules each declaring their own would
// typecheck fine and then fall through to a 500 at runtime.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
