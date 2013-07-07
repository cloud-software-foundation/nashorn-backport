/*
 * Copyright (c) 2010, 2013, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 * 
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2 only, as
 * published by the Free Software Foundation.
 * 
 * This code is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * version 2 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 * 
 * You should have received a copy of the GNU General Public License version
 * 2 along with this work; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA.
 * 
 * Please contact Oracle, 500 Oracle Parkway, Redwood Shores, CA 94065 USA
 * or visit www.oracle.com if you need additional information or have any
 * questions.
 */

/**
 * JDK-8006529 : Methods should not always get callee parameter, and they
 * should not be too eager in creation of scopes.
 *
 * @test
 * @run
 */

/*
 * This test script depends on nashorn Compiler internals. It uses reflection
 * to get access to private field and many public methods of Compiler and
 * FunctionNode classes. Note that this is trusted code and access to such
 * internal package classes and methods is okay. But, if you modify any 
 * Compiler or FunctionNode class, you may have to revisit this script.
 * We cannot use direct Java class (via dynalink bean linker) to Compiler
 * and FunctionNode because of package-access check and so reflective calls.
 */

var Parser            = Java.type("jdk.nashorn.internal.parser.Parser")
var Compiler          = Java.type("jdk.nashorn.internal.codegen.Compiler")
var Context           = Java.type("jdk.nashorn.internal.runtime.Context")
var ScriptEnvironment = Java.type("jdk.nashorn.internal.runtime.ScriptEnvironment")
var Source            = Java.type("jdk.nashorn.internal.runtime.Source")
var FunctionNode      = Java.type("jdk.nashorn.internal.ir.FunctionNode")
var ThrowErrorManager = Java.type("jdk.nashorn.internal.runtime.Context$ThrowErrorManager");

// Compiler class methods and fields
var parseMethod = Parser.class.getMethod("parse");
var compileMethod = Compiler.class.getMethod("compile");

// NOTE: private field. But this is a trusted test!
// Compiler.functionNode
var functionNodeField = Compiler.class.getDeclaredField("functionNode");
functionNodeField.setAccessible(true);

// FunctionNode methods

// FunctionNode.getFunctions method
var getFunctionsMethod = FunctionNode.class.getMethod("getFunctions");

// These are method names of methods in FunctionNode class
var allAssertionList = ['isVarArg', 'needsParentScope', 'needsCallee', 'needsScope', 'needsSelfSymbol', 'isSplit', 'hasEval', 'hasWith', 'hasDeepWithOrEval', 'allVarsInScope', 'isStrictMode']

// corresponding Method objects of FunctionNode class
var functionNodeMethods = {};
// initialize FunctionNode methods
(function() {
    for (var f in allAssertionList) {
        var method = allAssertionList[f];
        functionNodeMethods[method] = FunctionNode.class.getMethod(method);
    }
})();

// returns "script" functionNode from Compiler instance
function getScriptNode(compiler) {
    // compiler.functionNode
    return functionNodeField.get(compiler);
}

// returns functionNode.getFunctions().get(0)
function getFirstFunction(functionNode) {
    // functionNode.getFunctions().get(0)
    return getFunctionsMethod.invoke(functionNode).get(0);
}

// compile(script) -- compiles a script specified as a string with its 
// source code, returns a jdk.nashorn.internal.ir.FunctionNode object 
// representing it.
function compile(source) {
    var source   = new Source("<no name>", source);
    var parser   = new Parser(Context.getContext().getEnv(), source, new ThrowErrorManager());
    var func     = parseMethod.invoke(parser);
    var compiler = new Compiler(Context.getContext().getEnv(), func);

    compileMethod.invoke(compiler);

    return getScriptNode(compiler);
};

var allAssertions = (function() {
    var allAssertions = {}
    for(var assertion in allAssertionList) {
        allAssertions[allAssertionList[assertion]] = true
    }
    return allAssertions;
})();


// test(f[, assertions...]) tests whether all the specified assertions on the
// passed function node are true.
function test(f) {
    var assertions = {}
    for(var i = 1; i < arguments.length; ++i) {
        var assertion = arguments[i]
        if(!allAssertions[assertion]) {
            throw "Unknown assertion " + assertion + " for " + f;
        }
        assertions[assertion] = true
    }
    for(var assertion in allAssertions) {
        var expectedValue = !!assertions[assertion]
        if(functionNodeMethods[assertion].invoke(f) !== expectedValue) {
            throw "Expected " + assertion + " === " + expectedValue + " for " + f;
        }
    }
}

// testFirstFn(script[, assertions...] tests whether all the specified
// assertions are true in the first function in the given script; "script"
// is a string with the source text of the script.
function testFirstFn(script) {
    arguments[0] = getFirstFunction(compile(script))
    test.apply(null, arguments)
}

// ---------------------------------- ACTUAL TESTS START HERE --------------

// The simplest possible functions have no attributes set
testFirstFn("function f() { }")
testFirstFn("function f(x) { x }")

// A function referencing a global needs parent scope, and it needs callee
// (because parent scope is passed through callee)
testFirstFn("function f() { x }", 'needsCallee', 'needsParentScope')

// A function referencing "arguments" will have to be vararg. It also needs
// the callee, as it needs to fill out "arguments.callee".
testFirstFn("function f() { arguments }", 'needsCallee', 'isVarArg')

// A function referencing "arguments" will have to be vararg. If it is
// strict, it will not have to have a callee, though.
testFirstFn("function f() {'use strict'; arguments }", 'isVarArg', 'isStrictMode')

// A function defining "arguments" as a parameter will not be vararg.
testFirstFn("function f(arguments) { arguments }")

// A function defining "arguments" as a nested function will not be vararg.
testFirstFn("function f() { function arguments() {}; arguments; }")

// A function defining "arguments" as a local variable will be vararg.
testFirstFn("function f() { var arguments; arguments; }", 'isVarArg', 'needsCallee')

// A self-referencing function defined as a statement doesn't need a self 
// symbol, as it'll rather obtain itself from the parent scope.
testFirstFn("function f() { f() }", 'needsCallee', 'needsParentScope')

// A self-referencing function defined as an expression needs a self symbol,
// as it can't obtain itself from the parent scope.
testFirstFn("(function f() { f() })", 'needsCallee', 'needsSelfSymbol')

// A child function accessing parent's variable triggers the need for scope
// in parent
testFirstFn("(function f() { var x; function g() { x } })", 'needsScope')

// A child function accessing parent's parameter triggers the need for scope
// in parent
testFirstFn("(function f(x) { function g() { x } })", 'needsScope')

// A child function accessing a global variable triggers the need for parent
// scope in parent
testFirstFn("(function f() { function g() { x } })", 'needsParentScope', 'needsCallee')

// A child function redefining a local variable from its parent should not 
// affect the parent function in any way
testFirstFn("(function f() { var x; function g() { var x; x } })")

// Using "with" unleashes a lot of needs: parent scope, callee, own scope, 
// and all variables in scope. Actually, we could make "with" less wasteful,
// and only put those variables in scope that it actually references, similar
// to what nested functions do with variables in their parents.
testFirstFn("(function f() { var o; with(o) {} })", 'needsParentScope', 'needsCallee', 'needsScope', 'hasWith', 'hasDeepWithOrEval', 'allVarsInScope')

// Using "eval" is as bad as using "with" with the added requirement of
// being vararg, 'cause we don't know if eval will be using "arguments".
testFirstFn("(function f() { eval() })", 'needsParentScope', 'needsCallee', 'needsScope', 'hasEval', 'isVarArg', 'hasDeepWithOrEval', 'allVarsInScope')

// Nested function using "with" is pretty much the same as the parent
// function needing with.
testFirstFn("(function f() { function g() { var o; with(o) {} } })", 'needsParentScope', 'needsCallee', 'needsScope', 'hasDeepWithOrEval', 'allVarsInScope')
// Nested function using "eval" is almost the same as parent function using
// eval, but at least the parent doesn't have to be vararg.
testFirstFn("(function f() { function g() { eval() } })", 'needsParentScope', 'needsCallee', 'needsScope', 'hasDeepWithOrEval', 'allVarsInScope')

// Function with 250 named parameters is ordinary
testFirstFn("function f(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39, p40, p41, p42, p43, p44, p45, p46, p47, p48, p49, p50, p51, p52, p53, p54, p55, p56, p57, p58, p59, p60, p61, p62, p63, p64, p65, p66, p67, p68, p69, p70, p71, p72, p73, p74, p75, p76, p77, p78, p79, p80, p81, p82, p83, p84, p85, p86, p87, p88, p89, p90, p91, p92, p93, p94, p95, p96, p97, p98, p99, p100, p101, p102, p103, p104, p105, p106, p107, p108, p109, p110, p111, p112, p113, p114, p115, p116, p117, p118, p119, p120, p121, p122, p123, p124, p125, p126, p127, p128, p129, p130, p131, p132, p133, p134, p135, p136, p137, p138, p139, p140, p141, p142, p143, p144, p145, p146, p147, p148, p149, p150, p151, p152, p153, p154, p155, p156, p157, p158, p159, p160, p161, p162, p163, p164, p165, p166, p167, p168, p169, p170, p171, p172, p173, p174, p175, p176, p177, p178, p179, p180, p181, p182, p183, p184, p185, p186, p187, p188, p189, p190, p191, p192, p193, p194, p195, p196, p197, p198, p199, p200, p201, p202, p203, p204, p205, p206, p207, p208, p209, p210, p211, p212, p213, p214, p215, p216, p217, p218, p219, p220, p221, p222, p223, p224, p225, p226, p227, p228, p229, p230, p231, p232, p233, p234, p235, p236, p237, p238, p239, p240, p241, p242, p243, p244, p245, p246, p247, p248, p249, p250) { p250 = p249 }")

// Function with 251 named parameters is variable arguments
testFirstFn("function f(p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27, p28, p29, p30, p31, p32, p33, p34, p35, p36, p37, p38, p39, p40, p41, p42, p43, p44, p45, p46, p47, p48, p49, p50, p51, p52, p53, p54, p55, p56, p57, p58, p59, p60, p61, p62, p63, p64, p65, p66, p67, p68, p69, p70, p71, p72, p73, p74, p75, p76, p77, p78, p79, p80, p81, p82, p83, p84, p85, p86, p87, p88, p89, p90, p91, p92, p93, p94, p95, p96, p97, p98, p99, p100, p101, p102, p103, p104, p105, p106, p107, p108, p109, p110, p111, p112, p113, p114, p115, p116, p117, p118, p119, p120, p121, p122, p123, p124, p125, p126, p127, p128, p129, p130, p131, p132, p133, p134, p135, p136, p137, p138, p139, p140, p141, p142, p143, p144, p145, p146, p147, p148, p149, p150, p151, p152, p153, p154, p155, p156, p157, p158, p159, p160, p161, p162, p163, p164, p165, p166, p167, p168, p169, p170, p171, p172, p173, p174, p175, p176, p177, p178, p179, p180, p181, p182, p183, p184, p185, p186, p187, p188, p189, p190, p191, p192, p193, p194, p195, p196, p197, p198, p199, p200, p201, p202, p203, p204, p205, p206, p207, p208, p209, p210, p211, p212, p213, p214, p215, p216, p217, p218, p219, p220, p221, p222, p223, p224, p225, p226, p227, p228, p229, p230, p231, p232, p233, p234, p235, p236, p237, p238, p239, p240, p241, p242, p243, p244, p245, p246, p247, p248, p249, p250, p251) { p250 = p251 }", 'isVarArg')
