(function () {
  // Read-only export: never save or alter the supplied project.
  var output = new File('E:/Project/Code/Phiguess/output/region-material-review/ae-properties.json');
  var status = new File('E:/Project/Code/Phiguess/output/region-material-review/ae-inspect-status.txt');
  function write(file, text) { file.encoding='UTF-8';file.open('w');file.write(text);file.close(); }
  function stringify(value) {
    if(value===null)return 'null';
    if(typeof value==='string')return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t')+'"';
    if(typeof value==='number'||typeof value==='boolean')return String(value);
    var parts=[],i;
    if(value instanceof Array){for(i=0;i<value.length;i++)parts.push(stringify(value[i]));return '['+parts.join(',')+']';}
    for(i in value)if(value.hasOwnProperty(i))parts.push(stringify(i)+':'+stringify(value[i]));
    return '{'+parts.join(',')+'}';
  }
  function property(p) {
    var v={name:p.name,matchName:p.matchName};
    try{v.enabled=p.enabled;}catch(e){}
    if(p.propertyType===PropertyType.PROPERTY){
      try{var raw=p.value;if(raw===null||typeof raw==='number'||typeof raw==='boolean'||typeof raw==='string'||raw instanceof Array)v.value=raw;}catch(e){}
      try{if(p.expression)v.expression=p.expression;}catch(e){}
      if(p.numKeys){v.keys=[];for(var k=1;k<=p.numKeys;k++)v.keys.push({time:p.keyTime(k),value:p.keyValue(k)});}
    }else {v.children=[];for(var j=1;j<=p.numProperties;j++)v.children.push(property(p.property(j)));}
    return v;
  }
  try {
    write(status,'Opening project');app.beginSuppressDialogs();
    if(app.project)app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
    app.open(new File('E:/Project/region/region.aep'));
    var data={version:app.version,items:[]};
    for(var i=1;i<=app.project.numItems;i++){
      var item=app.project.item(i),entry={id:item.id,name:item.name};
      if(item instanceof CompItem){entry.width=item.width;entry.height=item.height;entry.duration=item.duration;entry.frameRate=item.frameRate;entry.layers=[];
        for(var j=1;j<=item.numLayers;j++){var layer=item.layer(j);var row={name:layer.name,index:j,enabled:layer.enabled,inPoint:layer.inPoint,outPoint:layer.outPoint,startTime:layer.startTime,properties:[]};
          try{row.source=layer.source.id;}catch(e){}
          for(var k=1;k<=layer.numProperties;k++)row.properties.push(property(layer.property(k)));
          entry.layers.push(row);
        }
      }else if(item instanceof FootageItem){try{entry.file=item.file.fsName;}catch(e){}entry.width=item.width;entry.height=item.height;}
      data.items.push(entry);
    }
    write(output,stringify(data));write(status,'Export complete');
    app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);app.endSuppressDialogs(false);app.quit();
  } catch(e){write(status,'ERROR: '+e.toString());try{app.endSuppressDialogs(false);app.quit();}catch(ignore){}}
})();
