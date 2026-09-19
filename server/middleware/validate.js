import { validate } from '../schemas/validate.js';

/** Validates and replaces `req.body`, dropping any undeclared field. */
export function validateBody(schema) {
  return (req, res, next) => {
    try {
      res.locals.body = validate(req.body, schema);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Validates `req.query` into `res.locals.query`. */
export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      res.locals.query = validate(req.query, schema);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
