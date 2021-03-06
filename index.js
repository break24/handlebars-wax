'use strict';

const fs = require('fs');
const path = require('path');
const requireGlob = require('require-glob');
const glob = require('glob');

const toString = Object.prototype.toString;

const ESCAPE_CHARACTERS = /[-/\\^$*+?.()|[\]{}]/g;
const NON_WORD_CHARACTERS = /\W+/g;
const PATH_SEPARATOR = '/';
const PATH_SEPARATORS = /[\\/]/g;
const WHITESPACE_CHARACTERS = /\s+/g;
const WORD_SEPARATOR = '-';
const TYPE_FUNCTION = 'fun';
const TYPE_OBJECT = 'obj';

// Utilities

function escapeRx(str) {
	return str.replace(ESCAPE_CHARACTERS, '\\$&');
}

function getTypeOf(value) {
	return toString
		.call(value)
		.substr(8, 3)
		.toLowerCase();
}

// Map Reduce

function keygenPartial(options, file) {
	const resolvedFilePath = fs.realpathSync(file.path);
	const resolvedFileBase = fs.realpathSync(file.base);

	const fullPath = resolvedFilePath.replace(PATH_SEPARATORS, PATH_SEPARATOR);
	const basePath =
		resolvedFileBase.replace(PATH_SEPARATORS, PATH_SEPARATOR) +
		PATH_SEPARATOR;
	const shortPath = fullPath.replace(
		new RegExp('^' + escapeRx(basePath), 'i'),
		''
	);
	const extension = path.extname(shortPath);

	return shortPath
		.substr(0, shortPath.length - extension.length)
		.replace(WHITESPACE_CHARACTERS, WORD_SEPARATOR);
}

function keygenHelper(options, file) {
	return keygenPartial(options, file).replace(
		NON_WORD_CHARACTERS,
		WORD_SEPARATOR
	);
}

function keygenDecorator(options, file) {
	return keygenHelper(options, file);
}

function reducer(options, obj, fileObj) {
	let value = fileObj.exports;

	if (!value) {
		return obj;
	}

	if (getTypeOf(value.register) === TYPE_FUNCTION) {
		value = value.register(options.handlebars, options);

		if (getTypeOf(value) === TYPE_OBJECT) {
			return Object.assign(obj, value);
		}

		return obj;
	}

	if (getTypeOf(value) === TYPE_OBJECT) {
		return Object.assign(obj, value);
	}

	obj[options.keygen(fileObj)] = value;

	return obj;
}

function resolveValue(options, value) {
	if (!value) {
		return {};
	}

	if (getTypeOf(value) === TYPE_FUNCTION) {
		value = value(options.handlebars, options);

		if (getTypeOf(value) === TYPE_OBJECT) {
			return value;
		}

		return {};
	}

	if (getTypeOf(value) === TYPE_OBJECT) {
		return reducer(options, {}, {exports: value});
	}

	return requireGlob.sync(value, options);
}

// Wax

function HandlebarsWax(handlebars, options) {
	const defaults = {
		handlebars,
		bustCache: true,
		cwd: process.cwd(),
		compileOptions: null,
		extensions: ['.handlebars', '.hbs', '.html'],
		templateOptions: null,
		parsePartialName: keygenPartial,
		parseHelperName: keygenHelper,
		parseDecoratorName: keygenDecorator,
		parseDataName: null
	};

	this.handlebars = handlebars;
	this.config = Object.assign(defaults, options);
	this.context = Object.create(null);

	this.engine = this.engine.bind(this);
}

HandlebarsWax.prototype.partials = function (partials, options) {
	options = Object.assign({}, this.config, options);
	options.keygen = options.parsePartialName;
	options.reducer = options.reducer || reducer;

	const files = glob.sync(partials, options);
	const compiledPartials = {};
	files.forEach(filenamePath => {
	  const templateString = fs.readFileSync(filenamePath, 'utf8');
	  const p = options.handlebars.compile(templateString);
	  const baseName = path.basename(filenamePath);
	  compiledPartials[baseName.split('.')[0]] = p;
	});
	options.handlebars.registerPartial(compiledPartials);
  
	return this;
};

HandlebarsWax.prototype.helpers = function (helpers, options) {
	options = Object.assign({}, this.config, options);
	options.keygen = options.parseHelperName;
	options.reducer = options.reducer || reducer;

	options.handlebars.registerHelper(resolveValue(options, helpers));

	return this;
};

HandlebarsWax.prototype.decorators = function (decorators, options) {
	options = Object.assign({}, this.config, options);
	options.keygen = options.parseDecoratorName;
	options.reducer = options.reducer || reducer;

	options.handlebars.registerDecorator(resolveValue(options, decorators));

	return this;
};

HandlebarsWax.prototype.data = function (data, options) {
	options = Object.assign({}, this.config, options);
	options.keygen = options.parseDataName;

	Object.assign(this.context, resolveValue(options, data));

	return this;
};

HandlebarsWax.prototype.compile = function (template, compileOptions) {
	const config = this.config;
	const context = this.context;

	compileOptions = Object.assign({}, config.compileOptions, compileOptions);

	if (getTypeOf(template) !== TYPE_FUNCTION) {
		template = this.handlebars.compile(template, compileOptions);
	}

	return function (data, templateOptions) {
		templateOptions = Object.assign(
			{},
			config.templateOptions,
			templateOptions
		);
		templateOptions.data = Object.assign({}, templateOptions.data);

		// {{@global.foo}} and {{@global._parent.foo}}
		templateOptions.data.global = Object.assign(
			{_parent: context},
			templateOptions.data.global || context
		);

		// {{@local.foo}} and {{@local._parent.foo}}
		templateOptions.data.local = Object.assign(
			{_parent: context},
			templateOptions.data.local || data
		);

		// {{foo}} and {{_parent.foo}}
		return template(
			Object.assign({_parent: context}, context, data),
			templateOptions
		);
	};
};

HandlebarsWax.prototype.engine = function (file, data, callback) {
	const config = this.config;
	const cache = this.cache || (this.cache = {});

	try {
		let template = cache[file];

		// istanbul ignore else
		if (!template || config.bustCache) {
			template = this.compile(fs.readFileSync(file, 'utf8'));
			cache[file] = template;
		}

		callback(null, template(data));
	} catch (err) {
		// istanbul ignore next
		callback(err);
	}

	return this;
};

// API

function handlebarsWax(handlebars, config) {
	return new HandlebarsWax(handlebars, config);
}

module.exports = handlebarsWax;
module.exports.HandlebarsWax = HandlebarsWax;
