/* eslint-disable max-depth */
const {
  GraphQLObjectType,
  GraphQLList,
  GraphQLInt,
  GraphQLNonNull
} = require('graphql');
const camelCase = require('camelcase');
const { EXPECTED_OPTIONS_KEY } = require('dataloader-sequelize');
const { resolver } = require('graphql-sequelize');
const { includeArguments, sanitizeFieldName, getBulkOption } = require('../utils');

module.exports = (options) => {

  const { mutation } = require('../resolvers')(options);
  const { dataloaderContext } = options;
  const Models = options.models;

  return (models, inputTypes, outputTypes) => {

    const createMutationFor = {};

    for (const inputTypeName in inputTypes) {
      const model = models[inputTypeName];

      if (model && (model.excludeMutations.length < 3 || Object.keys(model.mutations).length)) {
        createMutationFor[inputTypeName] = inputTypes[inputTypeName];
      }
    }

    return new GraphQLObjectType({
      name: 'Root_Mutations',
      fields: Object.keys(createMutationFor).reduce((allMutations, inputTypeName) => {

        const mutations = {};
        const inputType = inputTypes[inputTypeName];
        const model = models[inputTypeName];
        const key = model.primaryKeyAttributes[0];
        const aliases = model.graphql.alias;

        if (model.graphql.excludeMutations.indexOf('create') === -1) {
          mutations[camelCase(aliases.create || (inputTypeName + 'Add'))] = {
            type: outputTypes[inputTypeName], // what is returned by resolve, must be of type GraphQLObjectType
            description: 'Create a ' + inputTypeName,
            args: Object.assign({ [inputTypeName]: { type: inputType } }, includeArguments(options.includeArguments)),
            resolve: (source, args, context, info) => mutation(model, inputTypeName, source, args, context, info, 'create')
          };
        }

        if (model.graphql.excludeMutations.indexOf('update') === -1) {
          mutations[camelCase(aliases.update || (inputTypeName + 'Edit'))] = {
            type: outputTypes[inputTypeName] || GraphQLInt,
            description: 'Update a ' + inputTypeName,
            args: Object.assign({ [inputTypeName]: { type: inputType } }, includeArguments(options.includeArguments)),
            resolve: (source, args, context, info) => {
              const where = { [key]: args[inputTypeName][key] };

              return mutation(model, inputTypeName, source, args, context, info, 'update', where).
                then((boolean) => {
                  // `boolean` equals the number of rows affected (0 or 1)
                  return resolver(model, { [EXPECTED_OPTIONS_KEY]: dataloaderContext })(source, where, context, info);
                });
            }
          };
        }

        if (model.graphql.excludeMutations.indexOf('destroy') === -1) {
          mutations[camelCase(aliases.destroy || (inputTypeName + 'Delete'))] = {
            type: GraphQLInt,
            description: 'Delete a ' + inputTypeName,
            args: Object.assign({ [key]: { type: new GraphQLNonNull(GraphQLInt) } }, includeArguments()),
            resolve: (source, args, context, info) => {
              const where = { [key]: args[key] };

              return mutation(model, inputTypeName, source, args, context, info, 'destroy', where);
            }
          };
        }

        const hasBulkOptionCreate = getBulkOption(inputType.graphql.bulk, 'create');
        const hasBulkOptionEdit = getBulkOption(inputType.graphql.bulk, 'edit');

        if (hasBulkOptionCreate) {
          mutations[camelCase(aliases.create || (inputTypeName + 'AddBulk'))] = {
            type: (typeof hasBulkOptionCreate === 'string') ? new GraphQLList(outputTypes[inputTypeName]) : GraphQLInt, // what is returned by resolve, must be of type GraphQLObjectType
            description: 'Create bulk ' + inputTypeName + ' and return number of rows or created rows.',
            args: Object.assign({ [inputTypeName]: { type: new GraphQLList(inputType) } }, includeArguments()),
            resolve: (source, args, context, info) => mutation(inputType, inputTypeName, source, args, context, info, 'create', null, hasBulkOptionCreate)
          };
        }

        if (hasBulkOptionEdit) {

          mutations[camelCase(aliases.edit || (inputTypeName + 'EditBulk'))] = {
            type: outputTypes[inputTypeName] ? new GraphQLList(outputTypes[inputTypeName]) : GraphQLInt, // what is returned by resolve, must be of type GraphQLObjectType
            description: 'Update bulk ' + inputTypeName + ' and return number of rows modified or updated rows.',
            args: Object.assign({ [inputTypeName]: { type: new GraphQLList(inputType) } }, includeArguments()),
            resolve: async (source, args, context, info) => {
              const whereClause = { [key]: { [Models.Sequelize.Op.in]: args[inputTypeName].map((input) => input[key]) } };

              await mutation(inputType, inputTypeName, source, args, context, info, 'update', null, hasBulkOptionEdit);

              return resolver(inputType, { [EXPECTED_OPTIONS_KEY]: dataloaderContext })(source, whereClause, context, info);
            }
          };
        }

        if (inputType.graphql && inputType.graphql.mutations) {

          for (const mutation in inputType.graphql.mutations) {
            if (inputType.graphql.mutations[mutation]) {
              let isArray = false;
              // eslint-disable-next-line no-unused-vars
              let isRequired = false;
              let outPutType = GraphQLInt;
              let inPutType = GraphQLInt;
              let typeName = inputType.graphql.mutations[mutation].output;
              let inputTypeNameField = model.graphql.mutations[mutation].input;

              if (typeName) {

                const typeReference = sanitizeFieldName(typeName);

                typeName = typeReference.type;
                isArray = typeReference.isArray;
                isRequired = typeReference.isRequired;

                if (isArray) {
                  outPutType = new GraphQLList(outputTypes[typeName]);
                } else {
                  outPutType = outputTypes[typeName];
                }

              }

              if (inputTypeNameField) {

                const typeReference = sanitizeFieldName(inputTypeNameField);

                inputTypeNameField = typeReference.type;

                if (typeReference.isArray) {
                  inPutType = new GraphQLList(inputTypes[inputTypeNameField]);
                } else {
                  inPutType = inputTypes[inputTypeNameField];
                }

                if (typeReference.isRequired) {
                  inPutType = GraphQLNonNull(inPutType);
                }
              }

              mutations[camelCase(mutation)] = {
                type: outPutType,
                args: Object.assign({ [inputTypeNameField]: { type: inPutType } }, includeArguments()),
                resolve: (source, args, context, info) => {
                  const where = key && args[inputTypeName] ? { [key]: args[inputTypeName][key] } : {};

                  return options.authorizer(source, args, context, info).then((_) => {
                    return inputType.graphql.mutations[mutation].resolver(source, args, context, info, where);
                  }).then((data) => {
                    return options.logger(data, source, args, context, info).then(() => data);
                  });
                }
              };
            }
          }

        }

        return Object.assign(allMutations, mutations);

      }, {})
    });
  };

};