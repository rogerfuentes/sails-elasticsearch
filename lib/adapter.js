/**
 * Module Dependencies
 */
var _ = require('lodash'),
		Promise = require('bluebird'),
		Connection = require('./connection'),
		Collection = require('./collection'),
		async = require('async'),
		Errors = require('waterline-errors').adapter;



/**
 * sails-elasticsearch
 *
 * Most of the methods below are optional.
 *
 * If you don't need / can't get to every method, just implement
 * what you have time for.  The other methods will only fail if
 * you try to call them!
 *
 * For many adapters, this file is all you need.  For very complex adapters, you may need more flexiblity.
 * In any case, it's probably a good idea to start with one file and refactor only if necessary.
 * If you do go that route, it's conventional in Node to create a `./lib` directory for your private submodules
 * and load them at the top of the file with other dependencies.  e.g. var update = `require('./lib/update')`;
 */
module.exports = (function () {


	// You'll want to maintain a reference to each connection
	// that gets registered with this adapter.
	var connections = {};

	var adapter = {};

		// Set to true if this adapter supports (or requires) things like data types, validations, keys, etc.
		// If true, the schema for models using this adapter will be automatically synced when the server starts.
		// Not terribly relevant if your data store is not SQL/schemaful.
		//
		// If setting syncable, you should consider the migrate option,
		// which allows you to set how the sync will be performed.
		// It can be overridden globally in an app (config/adapters.js)
		// and on a per-model basis.
		//
		// IMPORTANT:
		// `migrate` is not a production data migration solution!
		// In production, always use `migrate: safe`
		//
		// drop   => Drop schema and data, then recreate it
		// alter  => Drop/add columns as necessary.
		// safe   => Don't change anything (good for production DBs)
		//
		adapter.syncable = false;


		// Default configuration for connections
		adapter.defaults = {
			hosts: ['127.0.0.1:9200'],
			sniffOnStart: true,
			sniffOnConnectionFault: true,
			keepAlive: false,
			apiVersion: '2.0'
		};

		/**
		 *
		 * This method runs when a model is initially registered
		 * at server-start-time.  This is the only required method.
		 *
		 * @param  {[type]}   connection [description]
		 * @param  {[type]}   collection [description]
		 * @param  {Function} cb         [description]
		 * @return {[type]}              [description]
		 */
		adapter.registerConnection = function(connection, collections, cb) {
			if(!connection.identity) return cb(Errors.IdentityMissing);
			if(connections[connection.identity]) return cb(Errors.IdentityDuplicate);

			// Store the connection
			connections[connection.identity] = {
				config: connection,
				collections: {}
			};

			// Create a new active connection
			new Connection(connection, function(err, es) {
				if(err) return cb(err);
				connections[connection.identity].connection = es;

				var indices = {};
				var mappings = {};
				for (var col in collections) {
					if (collections[col].elasticSearch) {
						indices[collections[col].elasticSearch.index] = true;
						if (!mappings[collections[col].elasticSearch.index]) {
							mappings[collections[col].elasticSearch.index] = {}
						}
						mappings[collections[col].elasticSearch.index][col] = collections[col].elasticSearch.mappings[col];
					}
				}				

				// We create the indices.
				async.eachSeries(Object.keys(indices), function iteratee(item, callback) {
					// First we check if the index exist
					es.client.indices.exists({
						index: item,
					}, function(err, exists) {
						if(err) { throw new Error(err) }

						if(exists) {
							callback(null, null);
						} else {
							es.client.indices.create({
								index: item,
								body : {
									mappings: mappings[item]
								}
							}, function(err, index) {
								if(err) throw new Error(err);
								callback(null, null);
							});
						}
					});
				}, function done() {
					// Build up a registry of collections
					Object.keys(collections).forEach(function(key) {
						if (collections[key].elasticSearch) {
							connections[connection.identity].collections[key] = new Collection(collections[key], es);
						}
					});
					cb();
				});
			});
		};


		/**
		 * Fired when a model is unregistered, typically when the server
		 * is killed. Useful for tearing-down remaining open connections,
		 * etc.
		 *
		 * @param  {Function} cb [description]
		 * @return {[type]}      [description]
		 */
		// Teardown a Connection
		adapter.teardown = function (conn, cb) {
			if (typeof conn == 'function') {
				cb = conn;
				conn = null;
			}
			if (!conn) {
				connections = {};
				return cb();
			}
			if(!connections[conn]) return cb();
			delete connections[conn];
			cb();
		};

		// Returns elastic search connection for custom methods
		adapter.client = function(connection, collection, cb){
			var promisifiedClient = Promise.promisifyAll(connections[connection].connection.client);
			if (cb) cb(null,promisifiedClient);
			else return promisifiedClient;
		};

		// Return attributes
		adapter.describe = function (connection, collection, cb) {
			console.log('describe');
			// Add in logic here to describe a collection (e.g. DESCRIBE TABLE logic)
			return cb();
		};

		/**
		 *
		 * REQUIRED method if integrating with a schemaful
		 * (SQL-ish) database.
		 *
		 */
		adapter.define = function (connection, collection, definition, cb) {
			console.log('define');
			// Add in logic here to create a collection (e.g. CREATE TABLE logic)
			return cb();
		};

		/**
		 *
		 * REQUIRED method if integrating with a schemaful
		 * (SQL-ish) database.
		 *
		 */
		adapter.drop = function (connection, collection, relations, cb) {
			console.log('drop');
			// Add in logic here to delete a collection (e.g. DROP TABLE logic)
			return cb();
		};

		/**
		 *
		 * REQUIRED method if users expect to call Model.find(), Model.findOne(),
		 * or related.
		 *
		 * You should implement this method to respond with an array of instances.
		 * Waterline core will take care of supporting all the other different
		 * find methods/usages.
		 *
		 */

		adapter.search = function (connectionName, collectionName, options, cb, indices) {
			options = options || {};
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Search documents
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.search(options, function(err, results){
						if (err)
							return reject(err)
						else
							return resolve(results)
					}, indices)
				})
			} else {
				collection.search(options, cb, indices);
			}
		};

		adapter.create = adapter.createIndex = function (connectionName, collectionName, options, parent, cb) {
			options = options || {};
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Index a document
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.insert(options, parent,function(err, res){
						if (err)
							return reject(err)
						else
							return resolve(res)
					})
				})
			} else {
				collection.insert(options, parent, cb);
			}
		};

		adapter.update = adapter.updateIndex = function (connectionName, collectionName, id, options, parent, cb) {
			options = options || {};
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Update a document
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.update(id, options, parent, function(err, res){
						if (err)
							return reject(err)
						else
							return resolve(res)
					})
				})
			} else {
				collection.update(id, options, parent, cb);
			}
		};

		adapter.destroy = adapter.destroyIndex = function (connectionName, collectionName, id, cb) {
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Delete a document
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.destroy(id, function(err, res){
						if (err)
							return reject(err)
						else
							return resolve(res)
					})
				})
			} else {
				collection.destroy(id, cb);
			}
		};

		adapter.countIndex = function (connectionName, collectionName, options, cb) {
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Count documents
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.count(options, function(err, res){
						if (err)
							return reject(err)
						else
							return resolve(res)
					})
				})
			} else {
				collection.count(options, cb);
			}
		};

		adapter.bulk = function (connectionName, collectionName, options, cb) {
			var connectionObject = connections[connectionName],
					collection = connectionObject.collections[collectionName];


			// Bulk documents
			if (cb === undefined) {
				return new Promise(function(resolve, reject){
					collection.bulk(options, function(err, res){
						if (err)
							return reject(err)
						else
							return resolve(res)
					})
				})
			} else {
				collection.bulk(options, cb);
			}
		};

	// Expose adapter definition
	return adapter;
})();

