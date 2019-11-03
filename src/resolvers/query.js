const _ = require('lodash');
const { resolver } = require('graphql-sequelize');
const { EXPECTED_OPTIONS_KEY } = require('dataloader-sequelize');
const hooks = require('./hooks');
const REVERSE_CLAUSE_STRING = 'reverse:';
const ASC = 'ASC';
const DESC = 'DESC';
const QUERY_TYPE = 'fetch';

module.exports = (options) => {

  const { dataloaderContext } = options;

  return async (model, inputTypeName, source, args, context, info, isAssociation = false) => {

    const graphql = isAssociation ? model.target.graphql : model.graphql;

    // No need to call authorizer again on associations
    if (!isAssociation) await options.authorizer(source, args, context, info);

    // query being overwritten at graphql.overwrite.fetch, run it and skip the rest
    if (_.has(graphql.overwrite, QUERY_TYPE)) {
      return graphql.overwrite[QUERY_TYPE](source, args, context, info);
    }

    // hook coming from graphql.before.fetch
    await hooks.before(isAssociation ? model.target : model, source, args, context, info, QUERY_TYPE);

    // sequelize-graphql before hook to parse orderby clause to make sure it supports multiple orderby
    const before = (findOptions, args, context) => {

      const orderArgs = args.order || '';
      const orderBy = [];

      if (orderArgs != '') {
        const orderByClauses = orderArgs.split(',');

        orderByClauses.forEach((clause) => {
          if (clause.indexOf(REVERSE_CLAUSE_STRING) === 0) {
            orderBy.push([clause.substring(REVERSE_CLAUSE_STRING.length), DESC]);
          } else {
            orderBy.push([clause, ASC]);
          }
        });

        findOptions.order = orderBy;

      }

      // if paranoid option from sequelize is set, this switch can be used to fetch archived, non-archived or all items.
      findOptions.paranoid = ((args.where && args.where.deletedAt && args.where.deletedAt.ne === null) || args.paranoid === false) ? false : model.options.paranoid;

      return findOptions;
    };

    // see if a scope is specified to be applied to find queries.
    const scope = Array.isArray(graphql.scopes) ? { method: [graphql.scopes[0], _.get(args, graphql.scopes[1], graphql.scopes[2] || null)] } : graphql.scopes;

    const data = await resolver((isAssociation ? model : model.scope(scope)), {
      [EXPECTED_OPTIONS_KEY]: dataloaderContext,
      before
    })(source, args, context, info);

    if (_.has(graphql.extend, QUERY_TYPE)) {
      await graphql.extend[QUERY_TYPE](data, source, args, context, info);
    }

    // Logger only runs for base query.
    if (!isAssociation) await options.logger(data, source, args, context, info);

    return data;

  };
};