// v0.0.1

var shouldOverride = function() {throw new Error('should override method')};

/**
 * A message that can be passed along the streams
 * @type {Object}
 */
Packet = {
	type: null,
	data: null,
	getValue: function() {
		return this.data;
	},
	setValue: function(val) {
		this.data = val;
	},
	clone: function() {
		var clone = Object.create(Object.getPrototypeOf(this));
		for (var i in this) {
			if (this.hasOwnProperty(i))
				clone[i] = _.clone(this[i]);
		}
		return clone;
	}
};

SimplePacket = Object.create(Packet);
_.extend(SimplePacket, {
	type: 'value'
});

NodeChangePacket = Object.create(Packet);
_.extend(NodeChangePacket, {
	type: 'valueChange',
	data: {
		origNode: null,
		val: null
	},
	getValue: function() {
		return this.data.val;
	},
	setValue: function(val, node) {
		if (!this.hasOwnProperty('data'))
			this.data = {};
		this.data.val = val;
		if (node)
			this.data.node = node;
	}
});

NodeMutatePacket = Object.create(Packet);
_.extend(NodeMutatePacket, {
	getValue: function(type) {
		if (!Node.isPrototypeOf(type))
			return;
		return this.getValue_();
	},
	getValue_: function() {}
});

NodeDisposePacket = Object.create(NodeMutatePacket);
_.extend(NodeDisposePacket, {
	type: 'dispose',
	data: {
		node: null
	},
	getValue_: function(channel) {
		return this.data.node;
	},
	setValue: function(node) {
		if (this.data.node)
			return;
		if (!this.hasOwnProperty('data'))
			this.data = {};
		this.data.node = node;
	}
});

NodeRemovePacket = Object.create(NodeMutatePacket);
_.extend(NodeRemovePacket, {
	type: 'remove',
	data: {
		node: null
	},
	getValue_: function() {
		return this.data.node;
	},
	setValue: function(node) {
		if (this.data.node)
			return;
		if (!this.hasOwnProperty('data'))
			this.data = {};
		this.data.node = node;
	}
});

NodeAddPacket = Object.create(NodeMutatePacket);
_.extend(NodeAddPacket, {
	type: 'add',
	data: {
		node: null
	},
	getValue_: function() {
		return this.data.parent;
	},
	getParent: function() {
		return this.data.parent;
	},
	getChild: function() {
		return this.data.child;
	},
	setValue: function(parent, child) {
		if (this.data.parent)
			return;
		if (!this.hasOwnProperty('data'))
			this.data = {};
		this.data.parent = parent;
		this.data.child = child;
	}
});

BulkPacket = Object.create(Packet)
_.extend(BulkPacket, {
	type: 'BulkPacket',
	getValue: function() {
		return _.map(this.data, function(data) {
			return data.getValue();
		});
	},
	setValue: function(val, i) {
		if (isPacket(val))
			val = val.getValue();
		if (i == null)
			_.each(val, function(val, i) {
				this.data[i].setValue(val);
			}, this);
		else
			this.data[i].setValue(i);
		this.length = this.data.length;
	},
	addValue: function(val) {
		if (isPacket(val))
			val = val.getValue();
		this.setValue(val);
		this.length = this.data.length;
	},
});

ChannelPacket = Object.create(Packet);
_.extend(ChannelPacket, {
	type: 'ChannelPacket',
	channel: null,
	setChannel: function(channel) {
		this.channel = channel;
	},
	getChannel: function(channel) {
		return this.channel;
	},
	getValue: function(value, channel) {
		if (channel == this.channel)
			return this.data;
	},

});

/**
 * Base stream that all other objects inherit from
 * @type {Object}
 */
Stream = {
	defaultPacket: SimplePacket,
	init: function() {
		this._listeners = [];
		this.cid = _.uniqueId();
		Plumber.registerStream(this);
		return this;
	},
	onData: function(fn, ctx) {
		this._listeners.push(_.bind(fn, ctx));
	},
	pipe: function(dest) {
		// this.onData(dest.give, dest);
		Plumber.pipe(this, dest);
		return dest;
	},
	give: function(val) {
		this.setVal(val);
	},
	convertToPacket: function(val) {
		if (!isPacket(val)) {
			var packet = Object.create(this.defaultPacket);
			packet.setValue(val);
			val = packet;
		}
		return val;
	},
	setVal: function(val) {
		val = this.convertToPacket(val);
		if (val.getValue(this) == null)
			this.send(val);
		else
			this.setVal_(val);
	},

	setVal_: function(val) {
		this.send(this.transform(val));
	},
	transform: function(val) {
		if (val.getValue() != null)
			return val;
	},
	send: function(val) {
		if (!val)
			return;
		Plumber.flow(this, val);
	},
	dispose: function() {
		Plumber.killStream(this);
	}
};

WeldedStream = Object.create(Stream);
_.extend(WeldedStream, {
	init: function() {
		Stream.init.call(this);
		this.streams = [].slice.call(arguments, 0);
		var streams = this.streams;
		for (var i = 0; i < this.streams.length - 1; i++) {
			this.streams[i].setVal__ = this.streams[i].setVal;
			this.streams[i].setVal = _.bind(this.setVal, this);
			this.streams[i].send = (function(i) {
				return function(val) {
					if (!val) return;
					streams[i+1].setVal_(val);
				};
			})(i);
		}
		this.streams[i].setVal__ = this.streams[i].setVal;
		this.streams[i].setVal = _.bind(this.setVal, this);
		streams[streams.length - 1].send = _.bind(this.send, this);
	},
	setVal: function(val) {
		this.streams[0].setVal__(val);
	},
	dispose: function() {
		for (var i = 0; i < this.streams.length; i++)
			this.streams[i].dispose();
		Stream.dispose.call(this);
	}
});

/**
 * Holds all the plumbing
 * @type {Object}
 */
Plumber = {
	_map: {},
	_streams: {},
	_weld: {},
	// showPiping: true,
	pipe: function() {
		var args = [].slice.call(arguments, 0);
		for (var i = 0; i < args.length; i++) {
			if (Plumber._weld[args[i].cid])
				args[i] = Plumber._weld[args[i].cid];
		}
		for (var i = 1; i < args.length; i++) {
			if (!Plumber._map[args[i-1].cid])
				Plumber._map[args[i-1].cid] = [];
			Plumber._map[args[i-1].cid].push(args[i].cid);
		}
	},
	insertBefore: function(orig, before) {
		if (orig.cid)
			orig = orig.cid;
		if (after.cid)
			after = after.cid;

		for (i in Plumber._map) {
			var index = _.indexOf(Plumber._map[i], orig);
			if (i != before && index > -1) {
				Plumber._map[i].splice(index, 1);
				if (!_.contains(Plumber._map[i], before))
					Plumber._map[i].push(before);
			}
		}

		if (!Plumber._map[before])
			Plumber._map[before] = [];
		Plumber._map[before] = _.union(Plumber._map[before], [orig]);
	},
	insertAfter: function(orig, after) {
		if (orig.cid)
			orig = orig.cid;
		if (after.cid)
			after = after.cid;

		if (!Plumber._map[after])
			Plumber._map[after] = [];
		Plumber._map[after] = _.union(Plumber._map[after], Plumber._map[orig] || []);
		Plumber._map[orig] = [after];
	},
	registerStream: function(stream) {
		Plumber._streams[stream.cid] = stream;
	},
	findPaths: function(start, end, visited) {
		if (start.cid)
			start = start.cid;
		if (end.cid)
			end = end.cid;
		visited = visited || [];

		if (_.contains(visited, start))
			return;

		visited.push(start);

		if (_.contains(Plumber._map[start], end))
			return [start];

		return _.map(Plumber._map[start], function(next) {
			return _.map(Plumber.findPaths(next, end, visited), function(path) {
				return start + '.' + path;
			});
		});
	},
	killPath: function(start, end) {
		if (start.cid)
			start = start.cid;
		if (end.cid)
			end = end.cid;

		if (!Plumber._map[start])
			return;
		var index = _.indexOf(Plumber._map[start], end);
		if (index < 0)
			return;
		Plumber._map[start].splice(index, 1);
	},
	killStream: function(stream) {
		if (!_.isString(stream))
			stream = stream.cid;
		_.each(Plumber._map, function(arr) {
			var ind = _.indexOf(arr, stream);
			if (ind < 0)
				return;
			arr.splice(ind, 0);
		});
		delete Plumber._map[stream];
		delete Plumber._streams[stream];
	},
	flow: function(stream, val) {
		_.each(Plumber._map[stream.cid], function(id) {
			if (Plumber.showPiping) {
				console.log(stream.cid + ' -> ' + val + ' -> ' + id);
			}
			Plumber._streams[id].setVal(val.clone());
		});
	},
	weld: function() {
		var weld = Object.create(WeldedStream);

		var streams = [].slice.call(arguments, 0);
		for (var i = 0; i < streams.length; i++) {
			if (_.isString(streams[i]))
				streams[i] = Plumber._streams[i];
			this._weld[streams[i].cid] = weld;
		}
		weld.init.apply(weld, streams);
		var ids = _.pluck(streams, 'cid');
		Plumber._map[weld.cid] = _.uniq(_.flatten(_.values(_.pick.apply(null, [Plumber._map].concat(ids)))));
		_.each(ids, function(id) {
			delete Plumber._map[id];
		});
		for (i in Plumber._map) {
			var found = false;
			for (var n = 0; n < ids.length; n++) {
				var index = _.indexOf(Plumber._map[i], ids[n]);
				if (index > -1) {
					found = true;
					Plumber._map[i].splice(index, 1);
				}
			}
			if (found)
				Plumber._map[i].push(weld.cid);
		};
		return weld;
	}
};



/**
 * Base node type to build structured data is also a stream
 * @type {[type]}
 */
Node = Object.create(Stream);
_.extend(Node, {
	defaultPacket: NodeChangePacket,
	init: function() {
		Stream.init.call(this);
		this._parent = null;
	},
	mirror: function(node) {
		this.mirrors_ = this.mirrors_ || [];
		this.mirrors_.push(node);
	},
	setParent: function(parent) {
		if (this._parent)
			this._parent.removeChild(this);
		this._parent = parent;
	},
	getParent: function() {
		return this._parent;
	},
	getChild: function() {
		return this;
	},
	contains: function(child) {
		var curr = child;
		while (curr.getParent()) {
			if (curr.getParent() == this)
				return true;
			curr = curr.getParent();
		}
		return false;
	},
	setVal: function(val) {
		if (NodeMutatePacket.isPrototypeOf(val) &&
				_.contains(this.mirrors_, val.getValue())) {
			if (NodeRemovePacket.isPrototypeOf(val))
				this.remove();
			if (NodeDisposePacket.isPrototypeOf(val)) {
				Stream.setVal.call(this, val);
				this.dispose();
				return;
			}
			if (NodeAddPacket.isPrototypeOf(val)) {
				var child = val.getChild();
				var clone = child.clone();
				var path = val.getValue().getPathTo(child);
				this.addChild(clone, path);
				child.pipe(clone);
				clone.mirror(child);
			}
		}
		Stream.setVal.call(this, val);
	},
	getPathTo: function(node) {
		return node.getPath().substring(this.getPath().length + 1);
	},
	getPath: function() {
		if (this.getParent())
			var path = this.getParent().getPath(this);
		return path.replace(/\.$/,'');
	},
	remove: function(node) {
		if (this.getParent() && this.getParent().removeChild)
			this.getParent().removeChild(this);
		this.setParent(null);
		var rpacket = Object.create(NodeRemovePacket);
		rpacket.setValue(node);
		this.send(rpacket);
	},
	dispose: function() {
		if (this.getParent())
			this.getParent().removeChild(this);
		var dpacket = Object.create(NodeDisposePacket);
		dpacket.setValue(this);
		this.send(dpacket);
		Stream.dispose.call(this);
	}
});

/**
 * A node that contains an order list of other nodes
 * @type {[type]}
 */
ListDataNode = Object.create(Node);
_.extend(ListDataNode, {
	init: function() {
		Node.init.call(this);
		this._list = [];
	},
	addChild: function(node,  index) {
		if (index == null)
			index = this._list.length;
		this._list.splice(+index, 0, node);
		node.setParent(this);
		var packet = Object.create(NodeAddPacket);
		packet.setValue(this, node);
		this.send(packet);
	},
	removeChild: function(node) {
		if (!_.isNumber(node)) {
			node = _.indexOf(this._list, node);
		}
		this._list.splice(node, 1).setParent(null);
	},
	toString: function() {
		return '[ ' + this._list.join(' , ') + ' ]'
	},
	getChild: function(child) {
		if (!child)
			return this;
		if (_.isNumber(child))
			return this._list[child];
		var path = child.split('.').reverse();
		var ret = this._list[path.pop()];
		if (path.length && ret);
			return ret.getChild(path.reverse().join('.'))
		return ret;
	},
	getPath: function(child) {
		if (!child)
			return Node.getPath.call(this);
		var name = this._list.indexOf(child) + '.';
		if (this.getParent())
			return this.getParent().getPath(this) + name;
		return name;
	},
	dispose: function() {
		_each(this._list, function(child) {
			child.dispose();
		});
		Node.dispose.call(this);
	}
});

/**
 * A node that holds child nodes by name
 * @type {[type]}
 */
MapDataNode = Object.create(Node);
_.extend(MapDataNode, {
	init: function() {
		Node.init.call(this);
		this._map = {};
	},
	addChild: function(node, name) {
		this._map[name] = node;
		node.setParent(this);
		this.give(_.extend(Object.create(Packet), {
			type: 'addNode',
			data: node
		}));
	},
	removeChild: function(node) {
		var ind = node;
		if (!_isString(ind)) {
			for (i in this._map) {
				if (this._map[i] == node) {
					ind = i;
				}
			}
		}
		this._map[ind].setParent(null);
		delete this._map[ind];
	},
	toString: function() {
		var str = [];
		for (var i in this._map) {
			str.push(i + ' : ' + this._map[i]);
		}
		return '{ ' + str.join(' , ') + ' }'
	},
	getPath: function(child) {
		if (!child)
			return Node.getPath.call(this);
		var name = '';
		for (var i in this._map)
			if (this._map[i] == child)
				name = i + '.'
		if (this.getParent())
			return this.getParent().getPath(this) + name;
		return name;
	},
	getChild: function(child) {
		if (!child)
			return this;
		var path = child.split('.').reverse();
		var ret = this._map[path.pop()];
		if (path.length && ret);
			return ret.getChild(path.reverse().join('.'))
		return ret;
	}
});

/**
 * Simple node that holds a value
 * @type {[type]}
 */
DataNode = Object.create(Node);
_.extend(DataNode, {
	init: function(val) {
		Node.init.call(this);
		this.streams = [];
		this.val = val;
	},
	consvertToPacket: function(val) {
		if (!isPacket(val)) {
			var packet = Object.create(NodeChangePacket);
			packet.setValue(val);
			val = packet;
		}
		return val;
	},
	transform: function(val) {
		if (val.getValue() == this.val)
			return;
		this.val = val.getValue();
		return val;
	},
	getVal: function() {
		return this.val;
	},
	toString: function() {
		return this.val;
	}
});

/**
 * Stream to buffer messages in to an array
 * @type {[type]}
 */
Buffer = Object.create(Stream);
_.extend(Buffer, {
	init: function(length) {
		Stream.init.call(this);
		this._buffer = Object.create(BulkPacket);
		this._maxLength = length;
		return this;
	},
	join: function(arr) {
		return arr.join('');
	},
	transform: function(val) {
		if (val.getValue() == null)
			return val;
		this._buffer.addValue(val);
		if (this._buffer.length >= this._maxLength) {
			var send = this._buffer;
			this._buffer = Object.create(BulkPacket);
			return send;
		}
	}
});

/**
 * will console.log whatever is passed in
 * @type {[type]}
 */
Log = Object.create(Stream);
_.extend(Log, {
	setVal: function(val) {
		if (val.getValue() != null)
			console.log(val.getValue());
		Stream.setVal.call(this, val);
	}
});

/**
 * Will stop data passing through if it doesn't pass the filter function
 * @type {[type]}
 */
Filter = Object.create(Stream);
_.extend(Filter, {
	init: function(filter) {
		this._filter = filter;
		return Stream.init.call(this);
	},
	transform: function(val) {
		if (val.getValue() == null || this._filter(val))
			return val;
	}
});

/**
 * Will send along the data returned after passing it through a function
 * @type {[type]}
 */
Transform = Object.create(Stream);
_.extend(Transform, {
	init: function(transform) {
		this._transform = transform;
		return Stream.init.call(this);
	},
	transform: function(val) {
		if (val.getValue() == null)
			return val;
		val.setValue(this._transform(val.getValue()));
		return val;
	}
});

/**
 * [Debounce description]
 * @type {[type]}
 */
Debounce = Object.create(Stream);
_.extend(Debounce, {
	init: function(time) {
		this.setVal_ = _.debounce(Stream.setVal_, time);
		return Stream.init.call(this);
	}
});

Throttle = Object.create(Stream);
_.extend(Throttle, {
	init: function(time) {
		this.setVal_ = _.throttle(Stream.setVal_, time);
		return Stream.init.call(this);
	}
});

Defer = Object.create(Stream);
_.extend(Defer, {
	init: function(time) {
		this.setTime(time);
		return Stream.init.call(this);
	},
	setTime: function(time) {
		this.time = time;
	},
	setVal_: function(val) {
		_.delay(_.bind(function() {
			Stream.setVal_.call(this, val);
		}, this), this.time);
	}
});

Split = Object.create(Stream);
_.extend(Split, {
	transform: function(val) {
		if (val.getValue() != null && _.isArray(val.getValue())) {
			_.each(val.getValue(), Stream.setVal, this);
		} else {
			return val;
		}
	}
});

Collect = Object.create(Stream);
_.extend(Collect, {
	init: function() {
		this._cache = Object.create(BulkPacket);
		this._timer = null;
		Stream.init.call(this);
	},
	transform: function(val) {
		var _this = this;
		if (!this._timer) {
			this._timer = _.delay(function() {
				_this._timer = null;
				var send = _this._cache;
				_this._cache = Object.create(BulkPacket);
				return send;
			}, 0);
		}
		_this._cache.addValue(val);
	}
});

Splitter = Object.create(Stream);
_.extend(Splitter, {
	init: function() {
		Stream.init.call(this);
		this.filters = [];
	},
	addGate: function(fn, stream) {
		var filter = Object.create(Filter);
		filter.init(fn);
		this.pipe(filter).pipe(stream);
		this.filters.push(filter);
	},
	dispose: function() {
		for (var i = 0; i < this.filters.length; i++) {
			this.filters[i].dispose();
		}
		this.filters = null;
		Stream.dispose.call(this);
	}
});

JSONtoNodes = function(obj) {
	if (_.isArray(obj)) {
		var n = Object.create(ListDataNode);
		n.init();
		for (var i = 0; i < obj.length; i++) {
			n.addChild(JSONtoNodes(obj[i]));
		}
		return n;
	}
	if (_.isObject(obj)) {
		n = Object.create(MapDataNode);
		n.init();
		for (i in obj) {
			n.addChild(JSONtoNodes(obj[i]), i);
		}
		return n;
	}
	n = Object.create(DataNode);
	n.init(obj);
	return n;
};

NodesToJSON = function(node) {
	if (MapDataNode.isPrototypeOf(node)) {
		var obj = {};
		for (var i in node._map) {
			obj[i] = NodesToJSON(node._map[i]);
		}
		return obj;
	}
	if (ListDataNode.isPrototypeOf(node)) {
		return _.map(node._list, NodesToJSON);
	}
	return node.val
};

cloneStructure = function(node) {
	return JSONtoNodes(NodesToJSON(node));
};

getPaths = function(json) {
	if (_.isArray(json) || _.isObject(json)) {
		var indices = [];
		var arr = [];
		if (_.isArray(json)) {
			for (var i = 0; i < json.length; i++)
				indices.push(i);
		} else {
			for (i in json)
				indices.push(i);
		}
		_.each(indices, function(i) {
			var paths = getPaths(json[i]);
			for (var n = 0; n < paths.length; n++)
				arr.push(i + '.' + paths[n]);
		});
		return _.map(arr, function(path) {
			return path.replace(/\.$/, '');
		});
	}
	return [''];
};

cloneWithLinks = function(node) {
	var json = NodesToJSON(node);
	var head = JSONtoNodes(json);
	_.each(getPaths(json), function(path) {
		node.getChild(path).pipe(head.getChild(path));
		head.getChild(path).mirror(node.getChild(path));
	});
	return head;
};

makeFactory = function(Type) {
	var args = [].slice.call(arguments, 1);
	return function() {
		var temp = Object.create(Type);
		temp.init.apply(temp, args.concat([].slice.call(arguments, 0)));
		return temp;
	}
};

isPacket = function(obj) {
	if (!_.isObject(obj))
		return false;
	for (var curr = Object.getPrototypeOf(obj); curr; curr = Object.getPrototypeOf(curr))
		if (curr == Packet)
			return true;
	return false;
};

a = Object.create(Stream).init();
b = Object.create(Stream).init();
c = Object.create(Buffer).init(3);
c.onData(function(val){console.log(val)});

var json = {
	a: [1,2,[4,5,{a:9}]],
	b: {r:3},
	c:'plop'
};

nodes = JSONtoNodes(json)

console.log(''+nodes);
console.log(NodesToJSON(nodes));

console.log(''+nodes.getChild('a.2.2'));
var copy = cloneWithLinks(nodes);

getAdder = makeFactory(Transform, function(a) {
	return a + 1;
});
getLogger = makeFactory(Log);
filter = Object.create(Filter)
filter.init(function(a) {return _.isNumber(a)})
flatten = Object.create(Transform)
flatten.init(function(arr){return _.flatten(arr).join('')})
add = Object.create(Transform)
add.init(function(a) {return a + 1});
log = Object.create(Log)
log.init()
buff = Object.create(Buffer);
buff.init(3)
nodes.getChild('c').pipe(getAdder()).pipe(getAdder()).pipe(getLogger())
nodes.getChild('c').setVal(1)
nodes.getChild('c').setVal(2)
nodes.getChild('c').setVal(3)
a = getAdder();
b = getAdder();
c = getAdder();
d = getLogger()
b.pipe(d)
b.setVal(8)
e = Plumber.weld(a,b,c)
e.setVal(1);
a.setVal(1);
b.setVal(1);
c.setVal(1);

LogIt = Object.create(Stream);
_.extend(LogIt, {
	init: function(a){
		this.a = a
		Stream.init.call(this);
	},
	setVal:function(val){
		console.log(this.a, val.getValue());
		return Stream.setVal.call(this, val);
	}
});
makeLogger = makeFactory(LogIt);
var json = {
	a: 1
};
getAdder = makeFactory(Transform, function(a) {
	return a + 1;
});
a = JSONtoNodes(json);
b = cloneWithLinks(a);
Plumber.weld(b.getChild('a'), getAdder());
a.getChild('a').pipe(makeLogger(1));
b.getChild('a').pipe(makeLogger(2));
a.getChild('a').setVal(2);

console.log(nodes.getChild('a.2').getPath())
console.log(nodes.getChild('a').getPathTo(nodes.getChild('a.2.2')))

var Leaf = Object.create(Stream);
_.extend(Leaf, {
	init: function(el) {
		Stream.init.call(this);
		this.el = el;
		var _this = this;
		el.addEventListener('change', function(el) {
			_this.setVal(parseInt(el.target.value));
		});
	},
	transform: function(val) {
		if (this.el.value == val)
			return;
		this.el.value = val.getValue();
		return val;
	}
});
makeLeaf = makeFactory(Leaf);

var inputs = document.getElementsByTagName('INPUT');

var l = makeLeaf(inputs[0]);
var la = makeLeaf(inputs[1]);
var lb = makeLeaf(inputs[2]);
var l2 = makeLeaf(inputs[3]);

var makeDefer = makeFactory(Defer);



var Pauser = Object.create(Stream);
_.extend(Pauser, {
	pause: function() {
		this.paused = !this.paused;
	},
	setVal: function(val) {
		if (!this.paused)
			Stream.setVal.call(this, val);
	}
});

var pauser = Object.create(Pauser);
pauser.init();

l.pipe(makeDefer(1000)).pipe(getAdder()).pipe(l);
la.pipe(makeDefer(1000)).pipe(getAdder()).pipe(la);
lb.pipe(makeDefer(1000)).pipe(getAdder()).pipe(lb);
l.pipe(pauser).pipe(l2);
la.pipe(pauser).pipe(l2);
lb.pipe(pauser).pipe(l2);

document.getElementById('pause').addEventListener('click', function() {
	pauser.pause();
});

a = JSONtoNodes({a: [0,1,2]})
b = cloneWithLinks(a);
a.getChild('a').addChild(JSONtoNodes(3));
console.log(''+a, ''+b);