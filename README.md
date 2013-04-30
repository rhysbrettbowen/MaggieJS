#MaggieJS#

Based on reactive concepts, streams from node.js and goog.ds.DataNodes

##Inheritance##

To create a type of object you will need to do:

```
var A = Object.create(MyObj);
A.init(args);
```

After you've set up your prototype definitions, it's recommended to create a factory function that can go ahead and create instance for you. Just do this:

```
var makeA = makeFactory(A);
```

then you can get a new A by calling the function and passing in any arguments for init:

```
var a = makeA(arg1, arg2);
```

##Stream##

A stream is the base of everything. It can take in an input and pass the output along. They pass along information in Packets which will be described later. There are a number of different types of stream available:

###streams###

####Buffer####

when initialised pass in the number of changes to initialize. The calls will only be passed along once that is reached as a single bulk call.

####Log####

will console.log any message passed in to it

####Filter####

Pass in a function to the init that takes the packet and return true or false whether to pass that packet along

####Transform####

Pass in a function that takes the packet and returns a packet that should be passed along

####Debounce####

will debounce packets passed in, pass in the debounce time to init

####Throttle####

Will throttle packets, pass in the throttle time to init

####Defer####

Will defer the message, pass in the time to defer to init

####Split####

Will split a packet whose value is an array and pass each value as an individual packet

####Collect####

Will collect in packets and aggregate their values to an array, works on a zero timeout so use carefully.

###Custom###

When creating your own custom streams, try not o override setVal or send (these are used internally), it is best to override the 'transform' function that will take in a packet and you should return the packet to send along (or a falsey value to not send anything). You can also set defaultPacket to change the output packet from a stream if the value given in setVal is not a packet.

##Packet##

A packet is just a wrapper around data to get passed along, it's used as an interface. Usually a SimplePacket is created. Here are the given packets:

###Pakets###

####NodeChangePacket####

given when a node changes (nodes shown in next section)

####BulkPacket####

Used when you want to batch packets together

###Custom###

You will want to override the setValue and getValue functions. These are always called to wrap and get the raw data of packets.

##Nodes##

Nodes represent your data, they can be easily converted to and from json data. Each data node is a stream which allows easy manipulation of the data and the ability to tie those changes to other streams.

##Plumber##

The Plumber is what handles all the piping between streams. It is a central place where a map is kept of all the linkages. This keeps object references out of streams so there is a central place to clean everything up. Because of this it also has some special abilities:

###Pipe###

usually called through a stream, will pipe streams through each other

###insertBefore###

will insert a stream before another stream, so any existing streams flowing in to it will be redirected through that stream first. WIll only work for existing streams, new streams will have to be piped to the new stream.

###insertAfter###

just like insertBefore but will pipe the output of the stream through this before going to any streams after

###registerStream###

called automatically by the Stream init function

###findPaths###

will give you a list of paths a packet could take between two streams

###killPath###

will kill a piping between two streams (not the whole path, use only for direct links)

###killStream###

called when a stream is disposed, kills it's links

###flow###

what actually passes along the (clones) of packets. Called automatically by the Streams send method

###weld###

gives the ability to weld together several streams in to a single stream. Any connections to the existing streams will be redirected to flow through the welded stream. This is handy for use on models which need formatting. For instance we could create a model that always has a parameter which is 1 more than it's original:

```
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
//2 3
//1 3
```

##Utilities##

###JSONtoNodes###

will convert your json to nodes

###NodesToJSON###

will convert a structure back to json

###Cloning###

You can also clone structures with cloneStructure or cloneStructureWithLinks that will connect the two so that clone is kept up to date

###isPacket###

check whether a value is a packet

###makeFactory###

Will take a stream type and return a function that will create new instance of that type for you

###getPaths###

Returns all the dot delimitted paths in a json (used by cloneWithLinks)

##Coming Soon##

###Leaves###

These are meant to be the views like a text box that you can use to hook up data nodes to things the user can interract with, there should also be an easy converter from events to streams.