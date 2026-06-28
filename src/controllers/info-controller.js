const {StatusCodes}=require('http-status-codes');
const info =(req,res)=>{
    return res.status(StatusCodes.OK).json({
        success:true,
        message:'API IS LIVE',
        error:{},
        data:{
            rabbitmqUrlSet: !!process.env.RABBITMQ_URL
        }
    });
}
module.exports={
    info
}